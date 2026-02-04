import JSZip from "jszip";
import pdfParse from "pdf-parse";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  detectMaterialKind,
  extractTextFromBuffer,
  sanitizeFilename,
} from "@/lib/materials/extract-text";

vi.mock("pdf-parse", () => ({
  default: vi.fn(),
}));

const pdfParseMock = pdfParse as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  pdfParseMock.mockReset();
});

describe("sanitizeFilename", () => {
  it("sanitizes unsafe characters", () => {
    const safe = sanitizeFilename("  My File (final).pdf ");
    expect(safe).toBe("My_File_final_.pdf");
  });

  it("uses a fallback when name is empty", () => {
    const safe = sanitizeFilename("   ");
    expect(safe).toBe("material");
  });

  it("enforces a max length", () => {
    const safe = sanitizeFilename("a".repeat(500) + ".pdf");
    expect(safe.length).toBeLessThanOrEqual(120);
  });

  it("collapses repeated underscores", () => {
    const safe = sanitizeFilename("multi___space   name.pdf");
    expect(safe).toBe("multi_space_name.pdf");
  });
});

describe("detectMaterialKind", () => {
  it("detects by MIME type when available", () => {
    const file = { name: "lecture.pdf", type: "application/pdf" } as File;
    expect(detectMaterialKind(file)).toBe("pdf");
  });

  it("detects by extension when MIME type is missing", () => {
    const file = { name: "slides.pptx", type: "" } as File;
    expect(detectMaterialKind(file)).toBe("pptx");
  });

  it("returns null for unsupported types", () => {
    const file = { name: "notes.txt", type: "text/plain" } as File;
    expect(detectMaterialKind(file)).toBeNull();
  });
});

describe("extractTextFromBuffer", () => {
  it("returns needs_vision for images", async () => {
    const result = await extractTextFromBuffer(Buffer.from("fake"), "image");
    expect(result.status).toBe("needs_vision");
    expect(result.text).toBe("");
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("extracts and normalizes text from PDFs", async () => {
    pdfParseMock.mockResolvedValueOnce({ text: "Hello   world\n\nNext" });
    const result = await extractTextFromBuffer(Buffer.from("pdf"), "pdf");
    expect(result.status).toBe("ready");
    expect(result.text).toBe("Hello world Next");
  });

  it("marks PDFs as failed when parsing throws", async () => {
    pdfParseMock.mockRejectedValueOnce(new Error("Bad PDF"));
    const result = await extractTextFromBuffer(Buffer.from("pdf"), "pdf");
    expect(result.status).toBe("failed");
    expect(result.warnings[0]).toContain("Bad PDF");
  });

  it("extracts text from a minimal DOCX payload", async () => {
    const buffer = await createZipBuffer({
      "word/document.xml": "<w:t>Hello</w:t><w:t>world</w:t>",
    });
    const result = await extractTextFromBuffer(buffer, "docx");
    expect(result.status).toBe("ready");
    expect(result.text).toBe("Hello world");
  });

  it("fails DOCX extraction when document.xml is missing", async () => {
    const buffer = await createZipBuffer({ "word/empty.xml": "noop" });
    const result = await extractTextFromBuffer(buffer, "docx");
    expect(result.status).toBe("failed");
    expect(result.warnings[0]).toContain("DOCX extraction");
  });

  it("extracts text from a minimal PPTX payload", async () => {
    const buffer = await createZipBuffer({
      "ppt/slides/slide1.xml": "<a:t>Slide</a:t><a:t>Text</a:t>",
    });
    const result = await extractTextFromBuffer(buffer, "pptx");
    expect(result.status).toBe("ready");
    expect(result.text).toBe("Slide Text");
  });

  it("fails PPTX extraction when no slides are present", async () => {
    const buffer = await createZipBuffer({ "ppt/notes.xml": "noop" });
    const result = await extractTextFromBuffer(buffer, "pptx");
    expect(result.status).toBe("failed");
    expect(result.warnings[0]).toContain("PPTX extraction");
  });
});

async function createZipBuffer(files: Record<string, string>) {
  const zip = new JSZip();
  Object.entries(files).forEach(([path, content]) => {
    zip.file(path, content);
  });
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}
