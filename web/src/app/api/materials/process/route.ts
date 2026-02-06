import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { extractTextFromBuffer, MaterialKind, MaterialSegment } from "@/lib/materials/extract-text";
import { chunkSegments } from "@/lib/materials/chunking";
import { extractVisionTextWithFallback, generateEmbeddingsWithFallback } from "@/lib/ai/providers";
import { isLowQualityText, runOcrOnImage, runOcrOnPdf } from "@/lib/materials/ocr";

export const runtime = "nodejs";

const MATERIALS_BUCKET = "materials";
const JOB_BATCH_SIZE = Number(process.env.MATERIAL_JOB_BATCH ?? 3);
const LOCK_TIMEOUT_MINUTES = Number(process.env.MATERIAL_JOB_LOCK_MINUTES ?? 15);
const VISION_PAGE_CONCURRENCY = Math.max(1, Number(process.env.VISION_PAGE_CONCURRENCY ?? 3) || 1);
const MAX_JOB_ATTEMPTS = Number(process.env.MATERIAL_JOB_MAX_ATTEMPTS ?? 5);
const TERMINAL_JOB_ERROR_FRAGMENTS = [
  "no embedding providers are configured",
  "no vision providers are configured",
  "embedding dimension mismatch",
  "openai embeddings are not configured",
  "openrouter embeddings are not configured",
  "gemini embeddings are not configured",
];

const SUPPORTED_MIME_TO_KIND: Record<string, MaterialKind> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "image/png": "image",
  "image/jpeg": "image",
  "image/webp": "image",
  "image/gif": "image",
};

export async function POST(req: Request) {
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

  const extraction = await extractTextFromBuffer(buffer, kind);
  let segments = extraction.segments;
  const warnings = [...extraction.warnings];

  if (extraction.status === "needs_vision") {
    const ocrResult = await runOcrPipeline(
      admin,
      classId,
      kind,
      buffer,
      material.mime_type ?? undefined,
    );
    segments = ocrResult.segments;
    warnings.push(...ocrResult.warnings);
  }

  if (!segments.length) {
    await updateMaterialStatus(admin, materialId, material.metadata, {
      status: "needs_vision",
      warnings: warnings.length > 0 ? warnings : ["No text could be extracted."],
      extraction_stats: extraction.stats,
    });
    return;
  }

  const chunks = chunkSegments(segments);
  if (!chunks.length) {
    await updateMaterialStatus(admin, materialId, material.metadata, {
      status: "needs_vision",
      warnings: warnings.length > 0 ? warnings : ["No usable text chunks produced."],
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
    warnings,
    extraction_stats: extraction.stats,
  });
}

async function runOcrPipeline(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  classId: string,
  kind: MaterialKind,
  buffer: Buffer,
  mimeType?: string,
) {
  const warnings: string[] = [];
  if (kind === "image") {
    const ocr = await runOcrOnImage(buffer);
    if (isLowQualityText(ocr.text, ocr.confidence)) {
      const vision = await extractVisionTextWithFallback({
        prompt: "Extract all readable text. Describe diagrams and equations.",
        images: [{ mimeType: mimeType ?? "image/png", data: buffer.toString("base64") }],
      });
      await logAiRequest(admin, {
        class_id: classId,
        provider: vision.provider,
        model: vision.model,
        purpose: "ocr",
        prompt_tokens: vision.usage?.promptTokens ?? null,
        completion_tokens: vision.usage?.completionTokens ?? null,
        total_tokens: vision.usage?.totalTokens ?? null,
        latency_ms: vision.latencyMs,
        status: "ok",
      });
      return {
        segments: [
          {
            text: vision.content,
            sourceType: "image" as const,
            sourceIndex: 1,
            extractionMethod: "vision" as const,
          },
        ],
        warnings: ["OCR low quality; used vision fallback."],
      };
    }

    return {
      segments: [
        {
          text: ocr.text,
          sourceType: "image" as const,
          sourceIndex: 1,
          extractionMethod: "ocr" as const,
          qualityScore: ocr.confidence,
        },
      ],
      warnings,
    };
  }

  if (kind === "pdf") {
    const { results, pageCount, totalPages } = await runOcrOnPdf(buffer);
    const segments = await mapWithConcurrency(
      results,
      VISION_PAGE_CONCURRENCY,
      async (result, index) => {
        if (isLowQualityText(result.text, result.confidence)) {
          const vision = await extractVisionTextWithFallback({
            prompt: "Extract all readable text. Describe diagrams and equations.",
            images: [{ mimeType: "image/png", data: result.imageBuffer.toString("base64") }],
          });
          await logAiRequest(admin, {
            class_id: classId,
            provider: vision.provider,
            model: vision.model,
            purpose: "ocr",
            prompt_tokens: vision.usage?.promptTokens ?? null,
            completion_tokens: vision.usage?.completionTokens ?? null,
            total_tokens: vision.usage?.totalTokens ?? null,
            latency_ms: vision.latencyMs,
            status: "ok",
          });
          return {
            text: vision.content,
            sourceType: "page",
            sourceIndex: index + 1,
            extractionMethod: "vision",
          } satisfies MaterialSegment;
        }

        return {
          text: result.text,
          sourceType: "page",
          sourceIndex: index + 1,
          extractionMethod: "ocr",
          qualityScore: result.confidence,
        } satisfies MaterialSegment;
      },
    );

    if (totalPages > pageCount) {
      warnings.push(`OCR limited to first ${pageCount} pages.`);
    }

    return { segments, warnings };
  }

  return { segments: [], warnings: ["OCR not supported for this material type."] };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
) {
  if (limit <= 1 || items.length <= 1) {
    const results: R[] = [];
    for (let index = 0; index < items.length; index += 1) {
      results.push(await mapper(items[index], index));
    }
    return results;
  }

  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) {
        break;
      }
      results[current] = await mapper(items[current], current);
    }
  });
  await Promise.all(runners);
  return results;
}

function resolveKind(mimeType?: string | null, metadataKind?: string, path?: string) {
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
    if (
      lower.endsWith(".png") ||
      lower.endsWith(".jpg") ||
      lower.endsWith(".jpeg") ||
      lower.endsWith(".webp") ||
      lower.endsWith(".gif")
    ) {
      return "image";
    }
  }
  return "pdf";
}

function isMaterialKind(value: string): value is MaterialKind {
  return value === "pdf" || value === "docx" || value === "pptx" || value === "image";
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
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
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
