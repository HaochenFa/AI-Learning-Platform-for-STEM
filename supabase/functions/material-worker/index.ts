import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import JSZip from "npm:jszip@3.10.1";
import * as pdfjs from "npm:pdfjs-dist@4.10.38/legacy/build/pdf.mjs";

type QueueMessage = {
  queue_message_id: number;
  payload: {
    job_id?: string;
    material_id?: string;
    class_id?: string;
  };
};

type MaterialKind = "pdf" | "docx" | "pptx";

type MaterialSegment = {
  text: string;
  sourceType: "page" | "slide" | "paragraph";
  sourceIndex: number;
  sectionTitle?: string;
  extractionMethod: "text";
  qualityScore?: number;
};

type ExtractionResult = {
  status: "ready" | "failed";
  segments: MaterialSegment[];
  warnings: string[];
  stats: {
    charCount: number;
    segmentCount: number;
  };
};

type EmbeddingResult = {
  provider: AiProvider;
  model: string;
  embeddings: number[][];
  latencyMs: number;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
};

type AiProvider = "openrouter" | "openai" | "gemini";

type MaterialChunk = {
  text: string;
  sourceType: MaterialSegment["sourceType"];
  sourceIndex: number;
  sectionTitle?: string;
  extractionMethod: MaterialSegment["extractionMethod"];
  qualityScore?: number;
  tokenCount: number;
};

const MATERIALS_BUCKET = "materials";
const DEFAULT_BATCH_SIZE = Number(Deno.env.get("MATERIAL_WORKER_BATCH") ?? "3");
const MAX_JOB_ATTEMPTS = Number(Deno.env.get("MATERIAL_JOB_MAX_ATTEMPTS") ?? "5");
const JOB_VISIBILITY_TIMEOUT_SECONDS = Number(
  Deno.env.get("MATERIAL_JOB_VISIBILITY_TIMEOUT_SECONDS") ?? "300",
);
const LOCK_TIMEOUT_MINUTES = Number(Deno.env.get("MATERIAL_JOB_LOCK_MINUTES") ?? "15");
const DEFAULT_CHUNK_TOKENS = Number(Deno.env.get("CHUNK_TOKENS") ?? "1000");
const DEFAULT_CHUNK_OVERLAP = Number(Deno.env.get("CHUNK_OVERLAP") ?? "100");
const MAX_PDF_PAGES = Number(Deno.env.get("PDF_TEXT_PAGE_LIMIT") ?? "40");

const TERMINAL_JOB_ERROR_FRAGMENTS = [
  "no embedding providers are configured",
  "embedding dimension mismatch",
  "openai embeddings are not configured",
  "openrouter embeddings are not configured",
  "gemini embeddings are not configured",
  "material not found",
  "missing supabase edge environment variables",
];

const SUPPORTED_MIME_TO_KIND: Record<string, MaterialKind> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const token = Deno.env.get("MATERIAL_WORKER_TOKEN");
  if (token) {
    const provided = getBearerToken(req.headers.get("authorization"));
    if (provided !== token) {
      return json({ error: "Unauthorized" }, 401);
    }
  }

  const supabase = createServiceSupabaseClient();

  let requestedBatchSize = DEFAULT_BATCH_SIZE;
  try {
    const body = (await req.json().catch(() => ({}))) as { batchSize?: number };
    if (typeof body.batchSize === "number" && Number.isFinite(body.batchSize)) {
      requestedBatchSize = Math.max(1, Math.min(25, Math.floor(body.batchSize)));
    }
  } catch {
    // Ignore malformed JSON and use defaults.
  }

  const messages = await dequeueMessages(supabase, requestedBatchSize);
  if (messages.length === 0) {
    return json({ processed: 0, succeeded: 0, failed: 0, retried: 0, errors: [] }, 200);
  }

  let succeeded = 0;
  let failed = 0;
  let retried = 0;
  const errors: string[] = [];

  for (const message of messages) {
    const payload = message.payload ?? {};
    if (!payload.job_id || !payload.material_id || !payload.class_id) {
      errors.push(`Invalid queue payload for message ${message.queue_message_id}.`);
      await ackMessage(supabase, message.queue_message_id);
      failed += 1;
      continue;
    }

    const claim = await claimJob(supabase, payload.job_id);
    if (!claim) {
      // Job no longer active; acknowledge message.
      await ackMessage(supabase, message.queue_message_id);
      continue;
    }

    try {
      await processMaterialJob(supabase, payload.material_id, payload.class_id);
      await supabase
        .from("material_processing_jobs")
        .update({ status: "done", stage: "complete", locked_at: null, last_error: null })
        .eq("id", payload.job_id);
      await ackMessage(supabase, message.queue_message_id);
      succeeded += 1;
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Processing failed.";
      const shouldFail = isTerminalJobError(messageText) || claim.attempts >= MAX_JOB_ATTEMPTS;

      await supabase
        .from("material_processing_jobs")
        .update({
          status: shouldFail ? "failed" : "retry",
          stage: shouldFail ? "failed" : "error",
          last_error: messageText,
          locked_at: null,
        })
        .eq("id", payload.job_id);

      if (shouldFail) {
        await markMaterialFailed(supabase, payload.material_id, messageText);
        await ackMessage(supabase, message.queue_message_id);
        failed += 1;
      } else {
        retried += 1;
      }

      errors.push(messageText);
    }
  }

  return json(
    {
      processed: messages.length,
      succeeded,
      failed,
      retried,
      errors,
    },
    200,
  );
});

function createServiceSupabaseClient() {
  const url = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("NEXT_PUBLIC_SUPABASE_URL");
  const secretKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SECRET_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_KEY");

  if (!url || !secretKey) {
    throw new Error("Missing Supabase edge environment variables.");
  }

  return createClient(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function dequeueMessages(supabase: SupabaseClient, batchSize: number) {
  const { data, error } = await supabase.rpc("dequeue_material_jobs", {
    p_limit: Math.max(1, Math.min(25, batchSize)),
    p_visibility_timeout_seconds: Math.max(30, JOB_VISIBILITY_TIMEOUT_SECONDS),
  });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as QueueMessage[]).filter((message) => Boolean(message.queue_message_id));
}

async function ackMessage(supabase: SupabaseClient, queueMessageId: number) {
  const { error } = await supabase.rpc("ack_material_job", {
    p_queue_message_id: queueMessageId,
  });

  if (error) {
    console.error("Failed to ack material queue message", {
      queueMessageId,
      error: error.message,
    });
  }
}

async function claimJob(supabase: SupabaseClient, jobId: string) {
  const { data: job, error } = await supabase
    .from("material_processing_jobs")
    .select("id, status, attempts, locked_at")
    .eq("id", jobId)
    .maybeSingle();

  if (error || !job) {
    return null;
  }

  const lockCutoff = Date.now() - LOCK_TIMEOUT_MINUTES * 60 * 1000;
  const staleProcessingLock =
    job.status === "processing" &&
    typeof job.locked_at === "string" &&
    Date.parse(job.locked_at) < lockCutoff;

  if (!(job.status === "pending" || job.status === "retry" || staleProcessingLock)) {
    return null;
  }

  const nextAttempts = (job.attempts ?? 0) + 1;
  const { data: claimed } = await supabase
    .from("material_processing_jobs")
    .update({
      status: "processing",
      stage: "processing",
      attempts: nextAttempts,
      locked_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", job.id)
    .eq("attempts", job.attempts)
    .select("id, attempts")
    .maybeSingle();

  return claimed ? { id: claimed.id as string, attempts: Number(claimed.attempts ?? nextAttempts) } : null;
}

async function processMaterialJob(supabase: SupabaseClient, materialId: string, classId: string) {
  const { data: material, error } = await supabase
    .from("materials")
    .select("id, class_id, storage_path, mime_type, metadata")
    .eq("id", materialId)
    .single();

  if (error || !material) {
    throw new Error(error?.message ?? "Material not found.");
  }

  const { data: file, error: downloadError } = await supabase
    .storage
    .from(MATERIALS_BUCKET)
    .download(material.storage_path);

  if (downloadError || !file) {
    throw new Error(downloadError?.message ?? "Failed to download material.");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = resolveKind(material.mime_type, asRecord(material.metadata)?.kind, material.storage_path);
  if (!kind) {
    await updateMaterialStatus(supabase, materialId, asRecord(material.metadata), {
      status: "failed",
      warnings: ["Unsupported material type. Upload PDF, DOCX, or PPTX."],
      extraction_stats: { charCount: 0, segmentCount: 0 },
    });
    return;
  }

  const extraction = await extractTextFromBinary({
    kind,
    bytes,
  });

  if (extraction.status !== "ready" || extraction.segments.length === 0) {
    await updateMaterialStatus(supabase, materialId, asRecord(material.metadata), {
      status: "failed",
      warnings:
        extraction.warnings.length > 0
          ? extraction.warnings
          : ["No text could be extracted."],
      extraction_stats: extraction.stats,
    });
    return;
  }

  const chunks = chunkSegments(extraction.segments);
  if (chunks.length === 0) {
    await updateMaterialStatus(supabase, materialId, asRecord(material.metadata), {
      status: "failed",
      warnings: ["No usable text chunks produced.", ...extraction.warnings],
      extraction_stats: extraction.stats,
    });
    return;
  }

  const embeddingsResult = await generateEmbeddingsWithFallback(chunks.map((chunk) => chunk.text));
  if (embeddingsResult.embeddings.length !== chunks.length) {
    throw new Error(
      `Embedding count mismatch: expected ${chunks.length}, got ${embeddingsResult.embeddings.length}.`,
    );
  }

  const expectedDim = Number(Deno.env.get("EMBEDDING_DIM") ?? "1536");
  const actualDim = embeddingsResult.embeddings[0]?.length ?? 0;
  if (actualDim !== expectedDim) {
    throw new Error(`Embedding dimension mismatch: expected ${expectedDim}, got ${actualDim}.`);
  }

  await logAiRequest(supabase, {
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

  await supabase.from("material_chunks").delete().eq("material_id", materialId);

  const { error: insertError } = await supabase.from("material_chunks").insert(
    chunks.map((chunk, index) => ({
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
    })),
  );

  if (insertError) {
    throw new Error(insertError.message);
  }

  await updateMaterialStatus(supabase, materialId, asRecord(material.metadata), {
    status: "ready",
    warnings: extraction.warnings,
    extraction_stats: extraction.stats,
  });
}

async function extractTextFromBinary(input: {
  kind: MaterialKind;
  bytes: Uint8Array;
}): Promise<ExtractionResult> {
  const warnings: string[] = [];

  try {
    let segments: MaterialSegment[] = [];

    if (input.kind === "pdf") {
      segments = await extractPdfTextSegments(input.bytes);
    } else if (input.kind === "docx") {
      segments = await extractDocxTextSegments(input.bytes);
    } else if (input.kind === "pptx") {
      segments = await extractPptxTextSegments(input.bytes);
    }

    return buildExtractionResult(segments, warnings);
  } catch (error) {
    return {
      status: "failed",
      segments: [],
      warnings: [error instanceof Error ? error.message : "Extraction failed."],
      stats: { charCount: 0, segmentCount: 0 },
    };
  }
}

async function extractDocxTextSegments(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const docFile = zip.file("word/document.xml");
  if (!docFile) {
    return [] as MaterialSegment[];
  }

  const xml = await docFile.async("string");
  const text = extractXmlText(xml, "w:t");
  const paragraphs = splitParagraphs(text);

  return paragraphs.map((paragraph, index) => ({
    text: cleanText(paragraph),
    sourceType: "paragraph" as const,
    sourceIndex: index + 1,
    extractionMethod: "text" as const,
  }));
}

async function extractPptxTextSegments(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const slideFiles = zip.file(/ppt\/slides\/slide\d+\.xml/);
  if (!slideFiles || slideFiles.length === 0) {
    return [] as MaterialSegment[];
  }

  const texts = await Promise.all(
    slideFiles.map((file) => file.async("string").then((xml) => extractXmlText(xml, "a:t"))),
  );

  return texts
    .map((text, index) => ({
      text: cleanText(text),
      sourceType: "slide" as const,
      sourceIndex: index + 1,
      extractionMethod: "text" as const,
    }))
    .filter((segment) => segment.text.length > 0);
}

async function extractPdfTextSegments(bytes: Uint8Array) {
  const loadingTask = pdfjs.getDocument({ data: bytes, disableWorker: true });
  const doc = await loadingTask.promise;
  const pageCount = Math.min(doc.numPages, Math.max(1, MAX_PDF_PAGES));
  const segments: MaterialSegment[] = [];

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item: { str?: string }) => item.str ?? "")
      .join(" ");
    const cleaned = cleanText(text);
    if (!cleaned) {
      continue;
    }

    segments.push({
      text: cleaned,
      sourceType: "page",
      sourceIndex: pageNumber,
      extractionMethod: "text",
    });
  }

  return segments;
}

function buildExtractionResult(segments: MaterialSegment[], warnings: string[]): ExtractionResult {
  const text = segments.map((segment) => segment.text).join("\n");
  const charCount = text.length;
  const normalizedWarnings =
    segments.length === 0
      ? (warnings.length > 0 ? warnings : ["No text could be extracted."])
      : warnings;

  return {
    status: segments.length > 0 ? "ready" : "failed",
    segments,
    warnings: normalizedWarnings,
    stats: {
      charCount,
      segmentCount: segments.length,
    },
  };
}

function extractXmlText(xml: string, tag: string) {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "g");
  const matches = Array.from(xml.matchAll(regex)).map((match) => decodeXml(match[1] ?? ""));
  return matches.join(" ");
}

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function splitParagraphs(text: string) {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function cleanText(text: string) {
  return text
    .replace(/\r/g, "")
    .replace(/-\n(?=\w)/g, "")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveKind(
  mimeType?: string | null,
  metadataKind?: unknown,
  path?: string,
): MaterialKind | null {
  if (typeof metadataKind === "string" && isMaterialKind(metadataKind)) {
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

async function updateMaterialStatus(
  supabase: SupabaseClient,
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

  const { error } = await supabase
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

function getMetadataWarnings(metadata: Record<string, unknown> | null) {
  const warnings = metadata?.warnings;
  if (!Array.isArray(warnings)) {
    return [] as string[];
  }
  return warnings.filter((warning): warning is string => typeof warning === "string");
}

async function markMaterialFailed(
  supabase: SupabaseClient,
  materialId: string,
  errorMessage: string,
) {
  const { data: material } = await supabase
    .from("materials")
    .select("metadata")
    .eq("id", materialId)
    .maybeSingle();

  const currentMetadata = asRecord(material?.metadata);
  const warning = `Processing failed: ${errorMessage}`;
  const warnings = Array.from(new Set([...getMetadataWarnings(currentMetadata), warning]));

  await updateMaterialStatus(supabase, materialId, currentMetadata, {
    status: "failed",
    warnings,
  });
}

function getBearerToken(authorizationHeader: string | null) {
  if (!authorizationHeader) {
    return null;
  }

  const match = authorizationHeader.match(/^Bearer\s+(.+?)\s*$/i);
  return match?.[1]?.trim() ?? null;
}

function isTerminalJobError(message: string) {
  const normalized = message.toLowerCase();
  return TERMINAL_JOB_ERROR_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

function resolveProviderOrder() {
  const preferred = normalizeProvider(Deno.env.get("AI_PROVIDER_DEFAULT"));
  const providers: AiProvider[] = [preferred];
  for (const provider of ["openrouter", "openai", "gemini"] as const) {
    if (!providers.includes(provider)) {
      providers.push(provider);
    }
  }
  return providers;
}

function normalizeProvider(value: string | undefined): AiProvider {
  if (value === "openai" || value === "gemini" || value === "openrouter") {
    return value;
  }
  return "openrouter";
}

function isEmbeddingConfigured(provider: AiProvider) {
  if (provider === "openrouter") {
    return Boolean(Deno.env.get("OPENROUTER_API_KEY") && Deno.env.get("OPENROUTER_EMBEDDING_MODEL"));
  }
  if (provider === "openai") {
    return Boolean(Deno.env.get("OPENAI_API_KEY") && Deno.env.get("OPENAI_EMBEDDING_MODEL"));
  }
  return Boolean(Deno.env.get("GEMINI_API_KEY") && Deno.env.get("GEMINI_EMBEDDING_MODEL"));
}

async function generateEmbeddingsWithFallback(inputs: string[]): Promise<EmbeddingResult> {
  const providers = resolveProviderOrder().filter(isEmbeddingConfigured);
  if (providers.length === 0) {
    throw new Error("No embedding providers are configured.");
  }

  let lastError: Error | null = null;
  for (const provider of providers) {
    try {
      if (provider === "openrouter") {
        return await callOpenRouterEmbeddings(inputs);
      }
      if (provider === "openai") {
        return await callOpenAIEmbeddings(inputs);
      }
      return await callGeminiEmbeddings(inputs);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Embedding request failed.");
    }
  }

  throw lastError ?? new Error("Embedding request failed.");
}

async function callOpenRouterEmbeddings(inputs: string[]): Promise<EmbeddingResult> {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  const model = Deno.env.get("OPENROUTER_EMBEDDING_MODEL");
  if (!apiKey || !model) {
    throw new Error("OpenRouter embeddings are not configured.");
  }

  const baseUrl = Deno.env.get("OPENROUTER_BASE_URL") ?? "https://openrouter.ai/api/v1";
  const referer = Deno.env.get("OPENROUTER_SITE_URL");
  const appTitle = Deno.env.get("OPENROUTER_APP_NAME");
  const started = Date.now();

  const response = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(referer ? { "HTTP-Referer": referer } : {}),
      ...(appTitle ? { "X-Title": appTitle } : {}),
    },
    body: JSON.stringify({ model, input: inputs }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message ?? "OpenRouter embeddings request failed.");
  }

  return {
    provider: "openrouter",
    model,
    embeddings: (data?.data ?? []).map((item: { embedding: number[] }) => item.embedding ?? []),
    latencyMs: Date.now() - started,
    usage: {
      promptTokens: data?.usage?.prompt_tokens,
      completionTokens: data?.usage?.completion_tokens,
      totalTokens: data?.usage?.total_tokens,
    },
  };
}

async function callOpenAIEmbeddings(inputs: string[]): Promise<EmbeddingResult> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  const model = Deno.env.get("OPENAI_EMBEDDING_MODEL");
  if (!apiKey || !model) {
    throw new Error("OpenAI embeddings are not configured.");
  }

  const started = Date.now();
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, input: inputs }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message ?? "OpenAI embeddings request failed.");
  }

  return {
    provider: "openai",
    model,
    embeddings: (data?.data ?? []).map((item: { embedding: number[] }) => item.embedding ?? []),
    latencyMs: Date.now() - started,
    usage: {
      promptTokens: data?.usage?.prompt_tokens,
      completionTokens: data?.usage?.completion_tokens,
      totalTokens: data?.usage?.total_tokens,
    },
  };
}

async function callGeminiEmbeddings(inputs: string[]): Promise<EmbeddingResult> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  const model = Deno.env.get("GEMINI_EMBEDDING_MODEL");
  if (!apiKey || !model) {
    throw new Error("Gemini embeddings are not configured.");
  }

  const started = Date.now();
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: inputs.map((input) => ({
          content: { parts: [{ text: input }] },
        })),
      }),
    },
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message ?? "Gemini embeddings request failed.");
  }

  return {
    provider: "gemini",
    model,
    embeddings: (data?.embeddings ?? []).map((item: { values: number[] }) => item?.values ?? []),
    latencyMs: Date.now() - started,
  };
}

function estimateTokenCount(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

function chunkSegments(segments: MaterialSegment[]) {
  const chunks: MaterialChunk[] = [];

  for (const segment of segments) {
    if (!segment.text.trim()) {
      continue;
    }

    const tokenCount = estimateTokenCount(segment.text);
    if (tokenCount <= DEFAULT_CHUNK_TOKENS) {
      chunks.push({
        text: segment.text,
        sourceType: segment.sourceType,
        sourceIndex: segment.sourceIndex,
        sectionTitle: segment.sectionTitle,
        extractionMethod: segment.extractionMethod,
        qualityScore: segment.qualityScore,
        tokenCount,
      });
      continue;
    }

    const words = segment.text.split(/\s+/g);
    const wordLengths = words.map((word) => word.length);
    let start = 0;

    while (start < words.length) {
      let end = start;
      let current = "";

      while (end < words.length) {
        const next = current ? `${current} ${words[end]}` : words[end];
        if (estimateTokenCount(next) > DEFAULT_CHUNK_TOKENS) {
          break;
        }
        current = next;
        end += 1;
      }

      if (current) {
        chunks.push({
          text: current,
          sourceType: segment.sourceType,
          sourceIndex: segment.sourceIndex,
          sectionTitle: segment.sectionTitle,
          extractionMethod: segment.extractionMethod,
          qualityScore: segment.qualityScore,
          tokenCount: estimateTokenCount(current),
        });
      }

      if (end >= words.length) {
        break;
      }

      if (!current) {
        const longWord = words[start];
        chunks.push({
          text: longWord,
          sourceType: segment.sourceType,
          sourceIndex: segment.sourceIndex,
          sectionTitle: segment.sectionTitle,
          extractionMethod: segment.extractionMethod,
          qualityScore: segment.qualityScore,
          tokenCount: estimateTokenCount(longWord),
        });
        start = Math.min(start + 1, words.length);
        continue;
      }

      const overlapWords = countOverlapWords(wordLengths, end, DEFAULT_CHUNK_OVERLAP);
      const maxOverlap = Math.max(0, end - start - 1);
      const safeOverlap = Math.min(overlapWords, maxOverlap);
      start = Math.max(0, end - safeOverlap);
    }
  }

  return chunks;
}

function countOverlapWords(wordLengths: number[], end: number, overlapTokens: number) {
  let tokens = 0;
  let count = 0;

  for (let index = end - 1; index >= 0; index -= 1) {
    tokens += Math.max(1, Math.ceil(wordLengths[index] / 4));
    count += 1;
    if (tokens >= overlapTokens) {
      break;
    }
  }

  return count;
}

async function logAiRequest(
  supabase: SupabaseClient,
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
  const { error } = await supabase.from("ai_requests").insert(payload);
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

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
