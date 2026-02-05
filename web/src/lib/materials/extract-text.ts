import JSZip from "jszip";
import pdfParse from "pdf-parse";
import { ALLOWED_EXTENSIONS } from "./constants";

export type MaterialKind = "pdf" | "docx" | "pptx" | "image";

export type MaterialSegment = {
  text: string;
  sourceType: "page" | "slide" | "paragraph" | "image";
  sourceIndex: number;
  sectionTitle?: string;
  extractionMethod: "text" | "ocr" | "vision";
  qualityScore?: number;
};

export type MaterialExtraction = {
  text: string;
  segments: MaterialSegment[];
  status: "ready" | "needs_vision" | "failed";
  warnings: string[];
  pageCount?: number;
  stats: {
    charCount: number;
    segmentCount: number;
  };
};

export { MAX_MATERIAL_BYTES, ALLOWED_MIME_TYPES, ALLOWED_EXTENSIONS } from "./constants";

const MIME_TO_KIND: Record<string, MaterialKind> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "image/png": "image",
  "image/jpeg": "image",
  "image/webp": "image",
  "image/gif": "image",
};

const EXT_TO_KIND: Record<string, MaterialKind> = {
  ".pdf": "pdf",
  ".docx": "docx",
  ".pptx": "pptx",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".webp": "image",
  ".gif": "image",
};

export function detectMaterialKind(file: File) {
  if (file.type && MIME_TO_KIND[file.type]) {
    return MIME_TO_KIND[file.type];
  }

  const name = file.name.toLowerCase();
  const extension = ALLOWED_EXTENSIONS.find((ext) => name.endsWith(ext));
  if (!extension) {
    return null;
  }

  return EXT_TO_KIND[extension] ?? null;
}

export function sanitizeFilename(name: string) {
  const trimmed = name.trim();
  if (!trimmed) {
    return "material";
  }
  return trimmed
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(0, 120);
}

export async function extractTextFromBuffer(
  buffer: Buffer,
  kind: MaterialKind,
): Promise<MaterialExtraction> {
  const warnings: string[] = [];

  try {
    if (kind === "pdf") {
      const pageTexts: string[] = [];
      const parsed = await pdfParse(buffer, {
        pagerender: async (page) => {
          const content = await page.getTextContent();
          const text = content.items.map((item: { str?: string }) => item.str ?? "").join(" ");
          pageTexts.push(text);
          return text;
        },
      });

      const segments = pageTexts.map((text, index) => {
        const cleaned = cleanText(text);
        return {
          text: cleaned,
          sourceType: "page" as const,
          sourceIndex: index + 1,
          extractionMethod: "text" as const,
        };
      });

      const combined = segments.map((segment) => segment.text).join("\n");
      const status = combined.trim().length === 0 ? "needs_vision" : "ready";

      return buildExtractionResult({
        segments,
        status,
        warnings,
        pageCount: parsed.numpages,
      });
    }

    if (kind === "docx") {
      const text = await extractDocxText(buffer);
      const paragraphs = splitParagraphs(text);
      const segments = paragraphs.map((paragraph, index) => ({
        text: cleanText(paragraph),
        sourceType: "paragraph" as const,
        sourceIndex: index + 1,
        extractionMethod: "text" as const,
      }));
      const status = text.trim().length === 0 ? "failed" : "ready";
      if (status === "failed") {
        warnings.push("DOCX extraction returned empty text.");
      }
      return buildExtractionResult({ segments, status, warnings });
    }

    if (kind === "pptx") {
      const slideTexts = await extractPptxText(buffer);
      const segments = slideTexts.map((text, index) => ({
        text: cleanText(text),
        sourceType: "slide" as const,
        sourceIndex: index + 1,
        extractionMethod: "text" as const,
      }));
      const status = slideTexts.join(" ").trim().length === 0 ? "failed" : "ready";
      if (status === "failed") {
        warnings.push("PPTX extraction returned empty text.");
      }
      return buildExtractionResult({ segments, status, warnings });
    }

    return buildExtractionResult({
      segments: [],
      status: "needs_vision",
      warnings: ["Image extraction requires OCR/vision."],
    });
  } catch (error) {
    return buildExtractionResult({
      segments: [],
      status: "failed",
      warnings: [error instanceof Error ? error.message : "Unknown extraction error."],
    });
  }
}

export async function extractTextFromFile(
  file: File,
  kind: MaterialKind,
): Promise<MaterialExtraction> {
  const buffer = Buffer.from(await file.arrayBuffer());
  return extractTextFromBuffer(buffer, kind);
}

async function extractDocxText(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const docFile = zip.file("word/document.xml");
  if (!docFile) {
    return "";
  }
  const xml = await docFile.async("string");
  return extractXmlText(xml, "w:t");
}

async function extractPptxText(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = zip.file(/ppt\/slides\/slide\d+\.xml/);
  if (!slideFiles || slideFiles.length === 0) {
    return [] as string[];
  }
  const texts = await Promise.all(
    slideFiles.map((file) => file.async("string").then((xml) => extractXmlText(xml, "a:t"))),
  );
  return texts.filter(Boolean);
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

function cleanText(text: string) {
  if (!text) {
    return "";
  }
  const withLineFixes = text
    .replace(/\r/g, "")
    .replace(/-\n(?=\w)/g, "")
    .replace(/\n+/g, " ");
  return withLineFixes.replace(/\s+/g, " ").trim();
}

function splitParagraphs(text: string) {
  if (!text) {
    return [] as string[];
  }
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function buildExtractionResult(input: {
  segments: MaterialSegment[];
  status: "ready" | "needs_vision" | "failed";
  warnings: string[];
  pageCount?: number;
}): MaterialExtraction {
  const text = input.segments.map((segment) => segment.text).join("\n");
  const charCount = text.length;
  return {
    text,
    segments: input.segments,
    status: input.status,
    warnings: input.warnings,
    pageCount: input.pageCount,
    stats: {
      charCount,
      segmentCount: input.segments.length,
    },
  };
}
