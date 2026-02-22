import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { extractTextFromBuffer, MaterialKind } from "@/lib/materials/extract-text";
import { chunkSegments } from "@/lib/materials/chunking";
import { generateEmbeddingsWithFallback } from "@/lib/ai/providers";

export const runtime = "nodejs";

const MATERIALS_BUCKET = "materials";
const JOB_BATCH_SIZE = Number(process.env.MATERIAL_JOB_BATCH ?? 3);
const LOCK_TIMEOUT_MINUTES = Number(process.env.MATERIAL_JOB_LOCK_MINUTES ?? 15);
const MAX_JOB_ATTEMPTS = Number(process.env.MATERIAL_JOB_MAX_ATTEMPTS ?? 5);
const TERMINAL_JOB_ERROR_FRAGMENTS = [
  "no embedding providers are configured",
  "embedding dimension mismatch",
  "openai embeddings are not configured",
  "openrouter embeddings are not configured",
  "gemini embeddings are not configured",
];

const SUPPORTED_MIME_TO_KIND: Record<string, MaterialKind> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};

async function handleProcessRequest(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const provided = getCronSecretFromRequest(req);
    if (provided !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const admin = createAdminSupabaseClient();
  const cutoff = new Date(Date.now() - LOCK_TIMEOUT_MINUTES * 60 * 1000).toISOString();

  const { data: jobs, error } = await admin
    .from("material_processing_jobs")
    .select("id, material_id, class_id, status, attempts")
    .in("status", ["pending", "retry"])
    .or(`locked_at.is.null,locked_at.lt.${cutoff}`)
    .order("created_at", { ascending: true })
    .limit(JOB_BATCH_SIZE);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let processed = 0;
  const failures: string[] = [];

  for (const job of jobs ?? []) {
    const claimed = await admin
      .from("material_processing_jobs")
      .update({
        status: "processing",
        stage: "processing",
        locked_at: new Date().toISOString(),
        attempts: job.attempts + 1,
      })
      .eq("id", job.id)
      .eq("status", job.status)
      .select("id")
      .maybeSingle();

    if (!claimed.data) {
      continue;
    }

    try {
      await processMaterialJob(admin, job.material_id, job.class_id);
      await admin
        .from("material_processing_jobs")
        .update({ status: "done", stage: "complete", locked_at: null })
        .eq("id", job.id);
      processed += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Processing failed.";
      failures.push(message);
      const shouldFail = isTerminalJobError(message) || job.attempts + 1 >= MAX_JOB_ATTEMPTS;
      await admin
        .from("material_processing_jobs")
        .update({
          status: shouldFail ? "failed" : "retry",
          stage: shouldFail ? "failed" : "error",
          last_error: message,
          locked_at: null,
        })
        .eq("id", job.id);

      if (shouldFail) {
        await markMaterialFailed(admin, job.material_id, message);
      }
    }
  }

  return NextResponse.json({ processed, failures });
}

export async function GET(req: Request) {
  return handleProcessRequest(req);
}

export async function POST(req: Request) {
  return handleProcessRequest(req);
}

async function processMaterialJob(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  materialId: string,
  classId: string,
) {
  const { data: material, error } = await admin
    .from("materials")
    .select("id, class_id, storage_path, mime_type, metadata")
    .eq("id", materialId)
    .single();

  if (error || !material) {
    throw new Error(error?.message ?? "Material not found.");
  }

  const { data: file } = await admin.storage.from(MATERIALS_BUCKET).download(material.storage_path);

  if (!file) {
    throw new Error("Failed to download material.");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const kind = resolveKind(material.mime_type, material.metadata?.kind, material.storage_path);
  if (!kind) {
    await updateMaterialStatus(admin, materialId, material.metadata, {
      status: "failed",
      warnings: ["Unsupported material type. Upload PDF, DOCX, or PPTX."],
      extraction_stats: { charCount: 0, segmentCount: 0 },
    });
    return;
  }

  const extraction = await extractTextFromBuffer(buffer, kind);
  if (extraction.status !== "ready" || extraction.segments.length === 0) {
    await updateMaterialStatus(admin, materialId, material.metadata, {
      status: "failed",
      warnings:
        extraction.warnings.length > 0 ? extraction.warnings : ["No text could be extracted."],
      extraction_stats: extraction.stats,
    });
    return;
  }

  const chunks = chunkSegments(extraction.segments);
  if (!chunks.length) {
    await updateMaterialStatus(admin, materialId, material.metadata, {
      status: "failed",
      warnings:
        extraction.warnings.length > 0
          ? extraction.warnings
          : ["No usable text chunks produced."],
      extraction_stats: extraction.stats,
    });
    return;
  }

  const embeddingsResult = await generateEmbeddingsWithFallback({
    inputs: chunks.map((chunk) => chunk.text),
  });
  if (!embeddingsResult.embeddings.length) {
    throw new Error("Embedding request returned no vectors.");
  }
  if (embeddingsResult.embeddings.length !== chunks.length) {
    throw new Error(
      `Embedding count mismatch: expected ${chunks.length}, got ${embeddingsResult.embeddings.length}.`,
    );
  }
  const expectedDim = Number(process.env.EMBEDDING_DIM ?? 1536);
  const actualDim = embeddingsResult.embeddings[0]?.length ?? 0;
  if (actualDim !== expectedDim) {
    throw new Error(`Embedding dimension mismatch: expected ${expectedDim}, got ${actualDim}.`);
  }

  await logAiRequest(admin, {
    class_id: classId,
    provider: embeddingsResult.provider,
    model: embeddingsResult.model,
    purpose: "embedding",
    prompt_tokens: embeddingsResult.usage?.promptTokens ?? null,
    completion_tokens: embeddingsResult.usage?.completionTokens ?? null,
    total_tokens: embeddingsResult.usage?.totalTokens ?? null,
    latency_ms: embeddingsResult.latencyMs,
    status: "ok",
  });

  const rows = chunks.map((chunk, index) => ({
    material_id: materialId,
    class_id: classId,
    source_type: chunk.sourceType,
    source_index: chunk.sourceIndex,
    section_title: chunk.sectionTitle ?? null,
    text: chunk.text,
    token_count: chunk.tokenCount,
    embedding: embeddingsResult.embeddings[index],
    embedding_provider: embeddingsResult.provider,
    embedding_model: embeddingsResult.model,
    extraction_method: chunk.extractionMethod,
    quality_score: chunk.qualityScore ?? null,
  }));

  await admin.from("material_chunks").delete().eq("material_id", materialId);
  const { error: insertError } = await admin.from("material_chunks").insert(rows);
  if (insertError) {
    throw new Error(insertError.message);
  }

  await updateMaterialStatus(admin, materialId, material.metadata, {
    status: "ready",
    warnings: extraction.warnings,
    extraction_stats: extraction.stats,
  });
}

function resolveKind(
  mimeType?: string | null,
  metadataKind?: string,
  path?: string,
): MaterialKind | null {
  if (metadataKind && isMaterialKind(metadataKind)) {
    return metadataKind;
  }
  if (mimeType && SUPPORTED_MIME_TO_KIND[mimeType]) {
    return SUPPORTED_MIME_TO_KIND[mimeType];
  }
  if (path) {
    const lower = path.toLowerCase();
    if (lower.endsWith(".pdf")) return "pdf";
    if (lower.endsWith(".docx")) return "docx";
    if (lower.endsWith(".pptx")) return "pptx";
  }
  return null;
}

function isMaterialKind(value: string): value is MaterialKind {
  return value === "pdf" || value === "docx" || value === "pptx";
}

function getCronSecretFromRequest(req: Request) {
  const headerSecret = req.headers.get("x-cron-secret");
  if (headerSecret) {
    return headerSecret;
  }

  const authorization = req.headers.get("authorization");
  if (!authorization) {
    return null;
  }
  const match = authorization.match(/^Bearer\s+(.+?)\s*$/i);
  return match?.[1]?.trim() ?? null;
}

function isTerminalJobError(message: string) {
  const normalized = message.toLowerCase();
  return TERMINAL_JOB_ERROR_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getMetadataWarnings(metadata: Record<string, unknown> | null) {
  const warnings = metadata?.warnings;
  if (!Array.isArray(warnings)) {
    return [] as string[];
  }
  return warnings.filter((warning): warning is string => typeof warning === "string");
}

async function markMaterialFailed(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  materialId: string,
  errorMessage: string,
) {
  const { data: material, error } = await admin
    .from("materials")
    .select("metadata")
    .eq("id", materialId)
    .maybeSingle();

  if (error) {
    console.error("Failed to fetch material metadata for failure update", {
      materialId,
      error: error.message,
    });
  }

  const currentMetadata = isObject(material?.metadata) ? material.metadata : null;
  const warning = `Processing failed: ${errorMessage}`;
  const warnings = Array.from(new Set([...getMetadataWarnings(currentMetadata), warning]));

  await updateMaterialStatus(admin, materialId, currentMetadata, {
    status: "failed",
    warnings,
  });
}

async function updateMaterialStatus(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  materialId: string,
  currentMetadata: Record<string, unknown> | null,
  update: {
    status: string;
    warnings: string[];
    extraction_stats?: { charCount: number; segmentCount: number };
  },
) {
  const nextMetadata: Record<string, unknown> = {
    ...(currentMetadata ?? {}),
    warnings: update.warnings,
  };
  if (update.extraction_stats) {
    nextMetadata.extraction_stats = update.extraction_stats;
  }

  const { error } = await admin
    .from("materials")
    .update({
      status: update.status,
      metadata: nextMetadata,
    })
    .eq("id", materialId);

  if (error) {
    console.error("Failed to update material status", {
      materialId,
      status: update.status,
      error: error.message,
    });
  }
}

async function logAiRequest(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  payload: {
    class_id: string | null;
    provider: string;
    model: string;
    purpose: string;
    prompt_tokens: number | null;
    completion_tokens: number | null;
    total_tokens: number | null;
    latency_ms: number;
    status: string;
  },
) {
  const { error } = await admin.from("ai_requests").insert(payload);
  if (error) {
    console.error("Failed to log AI request", {
      classId: payload.class_id,
      purpose: payload.purpose,
      provider: payload.provider,
      model: payload.model,
      error: error.message,
    });
  }
}
