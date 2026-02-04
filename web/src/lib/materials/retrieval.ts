import { generateEmbeddingsWithFallback } from "@/lib/ai/providers";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { estimateTokenCount } from "@/lib/materials/chunking";

export type RetrievedChunk = {
  id: string;
  material_id: string;
  material_title: string;
  source_type: string;
  source_index: number;
  section_title: string | null;
  text: string;
  token_count: number;
  similarity: number;
};

const DEFAULT_CONTEXT_TOKENS = Number(process.env.RAG_CONTEXT_TOKENS ?? 24000);
const DEFAULT_MATCH_COUNT = Number(process.env.RAG_MATCH_COUNT ?? 24);
const DEFAULT_MAX_PER_MATERIAL = Number(process.env.RAG_MAX_PER_MATERIAL ?? 6);

export async function retrieveMaterialContext(
  classId: string,
  query: string,
  maxTokens = DEFAULT_CONTEXT_TOKENS,
) {
  const embeddingResult = await generateEmbeddingsWithFallback({
    inputs: [query],
  });

  const [embedding] = embeddingResult.embeddings;
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("match_material_chunks", {
    p_class_id: classId,
    query_embedding: embedding,
    match_count: DEFAULT_MATCH_COUNT,
  });

  if (error) {
    throw new Error(error.message);
  }

  const chunks = (data ?? []) as RetrievedChunk[];
  const usageByMaterial = new Map<string, number>();
  const selected: RetrievedChunk[] = [];
  let usedTokens = 0;

  for (const chunk of chunks) {
    const used = usageByMaterial.get(chunk.material_id) ?? 0;
    if (used >= DEFAULT_MAX_PER_MATERIAL) {
      continue;
    }
    const chunkTokens = chunk.token_count || estimateTokenCount(chunk.text);
    if (usedTokens + chunkTokens > maxTokens) {
      break;
    }
    usageByMaterial.set(chunk.material_id, used + 1);
    selected.push(chunk);
    usedTokens += chunkTokens;
  }

  return buildContext(selected);
}

export function buildContext(chunks: RetrievedChunk[]) {
  if (chunks.length === 0) {
    return "";
  }

  return chunks
    .map((chunk, index) => {
      const header = `Source ${index + 1} | ${chunk.material_title} | ${chunk.source_type} ${chunk.source_index}`;
      return `${header}\n${chunk.text}`.trim();
    })
    .join("\n\n---\n\n");
}
