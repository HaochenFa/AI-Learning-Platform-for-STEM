import JSZip from "jszip";
import pdfParse from "pdf-parse";

export type MaterialKind = "pdf" | "docx" | "pptx" | "image";

export type MaterialExtraction = {
  text: string;
  status: "ready" | "needs_vision" | "failed";
  warnings: string[];
};

export const MAX_MATERIAL_BYTES = 20 * 1024 * 1024;

export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];

export const ALLOWED_EXTENSIONS = [
  ".pdf",
  ".docx",
  ".pptx",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
];

const MIME_TO_KIND: Record<string, MaterialKind> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
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
  kind: MaterialKind
): Promise<MaterialExtraction> {
  const warnings: string[] = [];

  try {
    if (kind === "pdf") {
      const parsed = await pdfParse(buffer);
      return {
        text: normalizeText(parsed.text),
        status: "ready",
        warnings,
      };
    }

    if (kind === "docx") {
      const text = await extractDocxText(buffer);
      return {
        text: normalizeText(text),
        status: text ? "ready" : "failed",
        warnings: text ? warnings : ["DOCX extraction returned empty text."],
      };
    }

    if (kind === "pptx") {
      const text = await extractPptxText(buffer);
      return {
        text: normalizeText(text),
        status: text ? "ready" : "failed",
        warnings: text ? warnings : ["PPTX extraction returned empty text."],
      };
    }

    return {
      text: "",
      status: "needs_vision",
      warnings: ["Image extraction requires a vision-capable LLM."],
    };
  } catch (error) {
    return {
      text: "",
      status: "failed",
      warnings: [
        error instanceof Error ? error.message : "Unknown extraction error.",
      ],
    };
  }
}

export async function extractTextFromFile(
  file: File,
  kind: MaterialKind
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
    return "";
  }
  const texts = await Promise.all(
    slideFiles.map((file) => file.async("string").then((xml) => extractXmlText(xml, "a:t")))
  );
  return texts.filter(Boolean).join("\n");
}

function extractXmlText(xml: string, tag: string) {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "g");
  const matches = Array.from(xml.matchAll(regex)).map((match) =>
    decodeXml(match[1] ?? "")
  );
  return matches.join(" ");
}

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}
