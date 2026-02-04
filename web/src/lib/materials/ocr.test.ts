import { afterEach, describe, expect, it, vi } from "vitest";

const createWorkerMock = vi.fn();
const pdfGetDocumentMock = vi.fn();
const createCanvasMock = vi.fn();

vi.mock("tesseract.js", () => ({
  createWorker: (...args: unknown[]) => createWorkerMock(...args),
}));

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  getDocument: (...args: unknown[]) => pdfGetDocumentMock(...args),
}));

vi.mock("@napi-rs/canvas", () => ({
  createCanvas: (...args: unknown[]) => createCanvasMock(...args),
}));

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
  vi.clearAllMocks();
});

async function loadOcr(overrides: Record<string, string> = {}) {
  process.env = { ...ORIGINAL_ENV, ...overrides };
  vi.resetModules();
  return import("@/lib/materials/ocr");
}

describe("runOcrOnImage", () => {
  it("uses the configured OCR language and returns text/confidence", async () => {
    const buffer = Buffer.from("image-bytes");
    const worker = {
      recognize: vi.fn(async () => ({ data: { text: "Hello", confidence: 88 } })),
      terminate: vi.fn(async () => undefined),
    };
    createWorkerMock.mockResolvedValueOnce(worker);

    const { runOcrOnImage } = await loadOcr({ OCR_LANGUAGE: "spa" });

    const result = await runOcrOnImage(buffer);

    expect(createWorkerMock).toHaveBeenCalledWith("spa");
    expect(worker.recognize).toHaveBeenCalledWith(buffer);
    expect(worker.terminate).toHaveBeenCalled();
    expect(result).toEqual({ text: "Hello", confidence: 88 });
  });
});

describe("runOcrOnPdf", () => {
  it("processes pages up to the configured max", async () => {
    const buffer = Buffer.from("pdf-bytes");
    const worker = {
      recognize: vi.fn(async () => ({ data: { text: "Page text", confidence: 75 } })),
      terminate: vi.fn(async () => undefined),
    };
    createWorkerMock.mockResolvedValue(worker);

    let canvasCalls = 0;
    createCanvasMock.mockImplementation(() => {
      canvasCalls += 1;
      return {
        getContext: vi.fn(() => ({})),
        toBuffer: vi.fn(() => Buffer.from(`page-${canvasCalls}`)),
      };
    });

    const doc = {
      numPages: 3,
      getPage: vi.fn(async () => ({
        getViewport: vi.fn(() => ({ width: 100, height: 200 })),
        render: vi.fn(() => ({ promise: Promise.resolve() })),
      })),
    };

    pdfGetDocumentMock.mockReturnValueOnce({ promise: Promise.resolve(doc) });

    const { runOcrOnPdf } = await loadOcr({ OCR_MAX_PDF_PAGES: "2" });

    const result = await runOcrOnPdf(buffer);

    expect(pdfGetDocumentMock).toHaveBeenCalledWith({ data: buffer });
    expect(doc.getPage).toHaveBeenCalledTimes(2);
    expect(createWorkerMock).toHaveBeenCalledTimes(2);
    expect(result.pageCount).toBe(2);
    expect(result.totalPages).toBe(3);
    expect(result.results).toHaveLength(2);
    expect(result.results[0]?.text).toBe("Page text");
    expect(result.results[0]?.confidence).toBe(75);
    expect(result.results[0]?.imageBuffer).toBeInstanceOf(Buffer);
  });
});

describe("isLowQualityText", () => {
  it("flags short text with low confidence", async () => {
    const { isLowQualityText } = await loadOcr();
    expect(isLowQualityText("short", 40)).toBe(true);
  });

  it("allows short text with high confidence", async () => {
    const { isLowQualityText } = await loadOcr();
    expect(isLowQualityText("short", 95)).toBe(false);
  });

  it("flags low confidence", async () => {
    const { isLowQualityText } = await loadOcr();
    expect(isLowQualityText("This is long enough text", 50)).toBe(true);
  });

  it("flags noisy text", async () => {
    const { isLowQualityText } = await loadOcr();
    const noisy = "@@@ ### $$$ %%% ^^^ !!! *** @@@ ### $$$";
    expect(isLowQualityText(noisy, 99)).toBe(true);
  });

  it("accepts clean text", async () => {
    const { isLowQualityText } = await loadOcr();
    const clean = "This is a sufficiently long sentence with mostly letters.";
    expect(isLowQualityText(clean, 90)).toBe(false);
  });
});
