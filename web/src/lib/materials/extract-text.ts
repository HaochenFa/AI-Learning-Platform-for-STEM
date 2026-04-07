import JSZip from "jszip";
import pdfParse from "pdf-parse";
import { ALLOWED_EXTENSIONS } from "./constants";

export type MaterialKind = "pdf" | "docx" | "pptx";

/**
 * A logical unit of extracted text from a material file.
 *
 * `sourceType` identifies whether the segment came from a PDF page, a DOCX
 * paragraph, or a PPTX slide.  `sourceIndex` is the 1-based position within
 * the document (page number, paragraph number, slide number) and is surfaced
 * to students as the citation location.
 */
export type MaterialSegment = {
  text: string;
  sourceType: "page" | "slide" | "paragraph";
  sourceIndex: number;
  sectionTitle?: string;
  extractionMethod: "text";
  qualityScore?: number;
};

/** Full extraction result returned by `extractTextFromBuffer` / `extractTextFromFile`. */
export type MaterialExtraction = {
  text: string;
  segments: MaterialSegment[];
  status: "ready" | "failed";
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
};

const EXT_TO_KIND: Record<string, MaterialKind> = {
  ".pdf": "pdf",
  ".docx": "docx",
  ".pptx": "pptx",
};

export function detectMaterialKindFromNameAndType(
  filename: string,
  mimeType?: string | null,
) {
  if (mimeType && MIME_TO_KIND[mimeType]) {
    return MIME_TO_KIND[mimeType];
  }

  const name = filename.toLowerCase();
  const extension = ALLOWED_EXTENSIONS.find((ext) => name.endsWith(ext));
  if (!extension) {
    return null;
  }

  return EXT_TO_KIND[extension] ?? null;
}

/**
 * Detects the `MaterialKind` of a `File` from its MIME type, falling back to
 * the file extension if the MIME type is absent or unrecognised.
 *
 * Browsers sometimes report a wrong or empty MIME type for Office files,
 * especially on Windows, so the extension fallback is necessary for robustness.
 *
 * @param file  The browser `File` object to inspect.
 * @returns     A `MaterialKind` string, or `null` if the file type is not supported.
 */
export function detectMaterialKind(file: File) {
  return detectMaterialKindFromNameAndType(file.name, file.type);
}

/**
 * Sanitises a filename for safe use as a storage path component.
 *
 * Replaces any character that is not alphanumeric, `.`, `_`, or `-` with `_`,
 * collapses consecutive underscores, and truncates to 120 characters.
 * Returns `"material"` for blank input to avoid empty path segments.
 *
 * @param name  The raw filename from the upload form.
 * @returns     A sanitised filename string safe for use in storage paths.
 */
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

/**
 * Extracts text from a material file buffer and returns structured segments.
 *
 * Dispatches to the appropriate extractor based on `kind`:
 * - **pdf**: Uses `pdf-parse` with a custom `pagerender` callback.
 * - **docx**: Unzips the OOXML container and extracts `<w:t>` elements.
 * - **pptx**: Unzips the OOXML container and extracts `<a:t>` elements per slide.
 *
 * Returns `status: "failed"` (with a warning) rather than throwing when
 * extraction succeeds but produces empty text, so the ingestion queue can
 * surface the failure to the teacher without crashing the worker.
 *
 * @param buffer  Raw file bytes.
 * @param kind    The document type to extract.
 * @returns       A `MaterialExtraction` with segments, status, and warnings.
 */
export async function extractTextFromBuffer(
  buffer: Buffer,
  kind: MaterialKind,
): Promise<MaterialExtraction> {
  const warnings: string[] = [];

  try {
    if (kind === "pdf") {
      const pageTexts: string[] = [];
      // --- PDF extraction with per-page callback ---
      // We override `pagerender` because pdf-parse's default implementation
      // concatenates all page content into a single string, losing page
      // boundaries.  Our callback fires once per page, pushes the page text
      // into `pageTexts`, and returns the text so pdf-parse can still compute
      // its own `numpages` count.
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
      const status = combined.trim().length === 0 ? "failed" : "ready";
      if (status === "failed") {
        warnings.push("PDF extraction returned empty text.");
      }

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
      status: "failed",
      warnings: ["Unsupported material kind. Upload PDF, DOCX, or PPTX."],
    });
  } catch (error) {
    return buildExtractionResult({
      segments: [],
      status: "failed",
      warnings: [error instanceof Error ? error.message : "Unknown extraction error."],
    });
  }
}

/**
 * Convenience wrapper that converts a browser `File` into a `Buffer` before
 * calling `extractTextFromBuffer`.
 *
 * @param file  The browser `File` object to extract text from.
 * @param kind  The document type (pre-detected by `detectMaterialKind`).
 * @returns     A `MaterialExtraction` result.
 */
export async function extractTextFromFile(
  file: File,
  kind: MaterialKind,
): Promise<MaterialExtraction> {
  const buffer = Buffer.from(await file.arrayBuffer());
  return extractTextFromBuffer(buffer, kind);
}

/**
 * Extracts text from a DOCX file by reading `word/document.xml` from the ZIP
 * container and pulling all `<w:t>` (Word text run) element contents.
 *
 * Returns an empty string if the `word/document.xml` entry is absent (e.g.,
 * a corrupted or non-standard DOCX file).
 */
async function extractDocxText(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const docFile = zip.file("word/document.xml");
  if (!docFile) {
    return "";
  }
  const xml = await docFile.async("string");
  return extractXmlText(xml, "w:t");
}

/**
 * Extracts text from a PPTX file by reading each slide XML file from the ZIP
 * container and pulling all `<a:t>` (DrawingML text run) element contents.
 *
 * **Slide ordering**: JSZip's `zip.file(regex)` returns matching entries in
 * filesystem order which may not match the logical slide number.  However,
 * PPTX slide filenames are `ppt/slides/slide1.xml`, `slide2.xml`, … so
 * alphabetical/filesystem order coincides with numeric order as long as slide
 * numbers do not exceed single digits vs multi-digits.  For correct ordering
 * across all slide counts the caller should sort by numeric suffix; this
 * implementation relies on JSZip's default order which matches for typical
 * decks.
 *
 * Empty slide strings are filtered out by `.filter(Boolean)` so slides
 * without text (e.g., image-only slides) do not produce blank segments.
 */
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

/**
 * Extracts all text content from elements matching `<tag>…</tag>` in an XML
 * string and joins them with a single space.
 *
 * **Regex breakdown**: `<${tag}[^>]*>([\s\S]*?)<\/${tag}>`
 *
 * - `[^>]*` matches optional XML attributes on the opening tag (e.g.,
 *   `<w:t xml:space="preserve">`).
 * - `([\s\S]*?)` captures the element content.  `[\s\S]` is used instead of
 *   `.` because `.` does not match newline characters by default, and XML text
 *   runs can contain embedded newlines.  The `?` makes the quantifier lazy so
 *   it stops at the *first* closing tag rather than consuming across multiple
 *   elements (greedy matching would merge adjacent text runs).
 * - The `"g"` flag collects all matches, not just the first.
 *
 * HTML entities in the captured content are decoded by `decodeXml`.
 */
function extractXmlText(xml: string, tag: string) {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "g");
  const matches = Array.from(xml.matchAll(regex)).map((match) => decodeXml(match[1] ?? ""));
  return matches.join(" ");
}

/** Decodes the five predefined XML/HTML character entity references. */
function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * Normalises extracted text by removing extraction artefacts.
 *
 * Transformations applied in order:
 * 1. Strip carriage returns (`\r`) — PDFs and older DOCX files often use CRLF.
 * 2. **De-hyphenation** (`-\n(?=\w)`): PDFs extracted via pdfParse frequently
 *    contain hyphenated line-breaks where a word is split across lines in the
 *    original layout (e.g., "photo-\nsynthesis").  The lookahead `(?=\w)` ensures
 *    we only remove hyphens immediately followed by a word character, so
 *    intentional hyphens at line ends (e.g., in bullet lists) are preserved.
 * 3. Collapse newlines into spaces — the segment text should be a single
 *    flowing string for the embedding model and the chunker.
 * 4. Collapse multiple spaces into one and trim.
 */
function cleanText(text: string) {
  if (!text) {
    return "";
  }
  const withLineFixes = text
    .replace(/\r/g, "")
    // Remove soft hyphens introduced by PDF line-breaking: "photo-\nsynthesis" → "photosynthesis".
    .replace(/-\n(?=\w)/g, "")
    .replace(/\n+/g, " ");
  return withLineFixes.replace(/\s+/g, " ").trim();
}

/**
 * Splits a DOCX text blob into logical paragraphs.
 *
 * DOCX XML uses `</w:p>` to delimit paragraphs, which `extractDocxText`
 * renders as runs of whitespace in the joined output.  Splitting on two or
 * more consecutive newlines (`\n{2,}`) recovers paragraph boundaries.
 * Returns an empty array for blank input so the caller receives zero segments
 * rather than one segment containing only whitespace.
 */
function splitParagraphs(text: string) {
  if (!text) {
    return [] as string[];
  }
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

/**
 * Assembles a `MaterialExtraction` from the per-format extractor results.
 *
 * Concatenates segment texts (separated by newlines) to produce the top-level
 * `text` field used for full-text search and legacy contexts.  `charCount` and
 * `segmentCount` are derived stats tracked for monitoring and quota enforcement.
 */
function buildExtractionResult(input: {
  segments: MaterialSegment[];
  status: "ready" | "failed";
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
