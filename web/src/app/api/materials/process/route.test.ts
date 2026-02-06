import { beforeEach, describe, expect, it, vi } from "vitest";

const extractTextFromBuffer = vi.fn();
const chunkSegments = vi.fn();
const generateEmbeddingsWithFallback = vi.fn();
const runOcrOnImage = vi.fn();
const runOcrOnPdf = vi.fn();
const isLowQualityText = vi.fn();

const jobUpdates: Array<Record<string, unknown>> = [];
const materialUpdates: Array<Record<string, unknown>> = [];

const mockJob = {
  id: "job-1",
  material_id: "material-1",
  class_id: "class-1",
  status: "pending",
  attempts: 0,
};

function makeJobBuilder() {
  const builder: Record<string, unknown> = {};

  builder.select = vi.fn(() => builder);
  builder.in = vi.fn(() => builder);
  builder.or = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.limit = vi.fn(async () => ({ data: [mockJob], error: null }));
  builder.update = vi.fn((payload: Record<string, unknown>) => {
    jobUpdates.push(payload);
    return builder;
  });
  builder.eq = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(async () => ({ data: { id: mockJob.id }, error: null }));
  builder.then = (
    onFulfilled: (value: unknown) => unknown,
    onRejected: (reason: unknown) => unknown,
  ) => Promise.resolve({ error: null }).then(onFulfilled, onRejected);

  return builder;
}

function makeMaterialsBuilder() {
  const builder: Record<string, unknown> = {};
  let selectedColumns = "";

  builder.select = vi.fn((columns: string) => {
    selectedColumns = columns;
    return builder;
  });
  builder.eq = vi.fn(() => builder);
  builder.single = vi.fn(async () => {
    if (selectedColumns.includes("storage_path")) {
      return {
        data: {
          id: "material-1",
          class_id: "class-1",
          storage_path: "classes/class-1/material-1/notes.pdf",
          mime_type: "application/pdf",
          metadata: { warnings: ["Existing warning"] },
        },
        error: null,
      };
    }

    return { data: null, error: null };
  });
  builder.maybeSingle = vi.fn(async () => ({
    data: { metadata: { warnings: ["Existing warning"] } },
    error: null,
  }));
  builder.update = vi.fn((payload: Record<string, unknown>) => {
    materialUpdates.push(payload);
    return builder;
  });
  builder.then = (
    onFulfilled: (value: unknown) => unknown,
    onRejected: (reason: unknown) => unknown,
  ) => Promise.resolve({ error: null }).then(onFulfilled, onRejected);

  return builder;
}

function makeMaterialChunksBuilder() {
  const builder: Record<string, unknown> = {};
  builder.delete = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.insert = vi.fn(async () => ({ error: null }));
  builder.then = (
    onFulfilled: (value: unknown) => unknown,
    onRejected: (reason: unknown) => unknown,
  ) => Promise.resolve({ error: null }).then(onFulfilled, onRejected);
  return builder;
}

const adminClient = {
  from: vi.fn((table: string) => {
    if (table === "material_processing_jobs") {
      return makeJobBuilder();
    }
    if (table === "materials") {
      return makeMaterialsBuilder();
    }
    if (table === "material_chunks") {
      return makeMaterialChunksBuilder();
    }
    if (table === "ai_requests") {
      return {
        insert: vi.fn(async () => ({ error: null })),
      };
    }
    return {
      select: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })),
    };
  }),
  storage: {
    from: vi.fn(() => ({
      download: vi.fn(async () => ({ data: new Blob(["pdf"], { type: "application/pdf" }) })),
    })),
  },
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: vi.fn(() => adminClient),
}));

vi.mock("@/lib/materials/extract-text", () => ({
  extractTextFromBuffer: (...args: unknown[]) => extractTextFromBuffer(...args),
}));

vi.mock("@/lib/materials/chunking", () => ({
  chunkSegments: (...args: unknown[]) => chunkSegments(...args),
}));

vi.mock("@/lib/ai/providers", () => ({
  generateEmbeddingsWithFallback: (...args: unknown[]) => generateEmbeddingsWithFallback(...args),
  extractVisionTextWithFallback: vi.fn(),
}));

vi.mock("@/lib/materials/ocr", () => ({
  runOcrOnImage: (...args: unknown[]) => runOcrOnImage(...args),
  runOcrOnPdf: (...args: unknown[]) => runOcrOnPdf(...args),
  isLowQualityText: (...args: unknown[]) => isLowQualityText(...args),
}));

describe("POST /api/materials/process", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jobUpdates.length = 0;
    materialUpdates.length = 0;
    delete process.env.CRON_SECRET;

    extractTextFromBuffer.mockResolvedValue({
      text: "algebra notes",
      segments: [
        {
          text: "algebra notes",
          sourceType: "page",
          sourceIndex: 1,
          extractionMethod: "text",
        },
      ],
      status: "ready",
      warnings: [],
      stats: { charCount: 13, segmentCount: 1 },
    });
    chunkSegments.mockReturnValue([
      {
        sourceType: "page",
        sourceIndex: 1,
        sectionTitle: null,
        text: "algebra notes",
        tokenCount: 2,
        extractionMethod: "text",
        qualityScore: null,
      },
    ]);
    generateEmbeddingsWithFallback.mockRejectedValue(new Error("No embedding providers are configured."));
  });

  it("marks material as failed when processing hits a terminal configuration error", async () => {
    const { POST } = await import("@/app/api/materials/process/route");

    const response = await POST(new Request("http://localhost/api/materials/process", { method: "POST" }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.processed).toBe(0);
    expect(payload.failures).toContain("No embedding providers are configured.");

    expect(jobUpdates.some((update) => update.status === "failed")).toBe(true);
    const failedMaterialUpdate = materialUpdates.find((update) => update.status === "failed");
    expect(failedMaterialUpdate).toBeTruthy();
    expect((failedMaterialUpdate?.metadata as { warnings?: string[] }).warnings).toEqual(
      expect.arrayContaining([
        "Existing warning",
        "Processing failed: No embedding providers are configured.",
      ]),
    );
  });

  it("accepts bearer auth for cron secret", async () => {
    process.env.CRON_SECRET = "test-secret";
    const { POST } = await import("@/app/api/materials/process/route");

    const response = await POST(
      new Request("http://localhost/api/materials/process", {
        method: "POST",
        headers: {
          Authorization: "Bearer test-secret",
        },
      }),
    );

    expect(response.status).toBe(200);
  });

  it("rejects unauthorized requests when cron secret is configured", async () => {
    process.env.CRON_SECRET = "test-secret";
    const { POST } = await import("@/app/api/materials/process/route");

    const response = await POST(new Request("http://localhost/api/materials/process", { method: "POST" }));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe("Unauthorized");
  });
});
