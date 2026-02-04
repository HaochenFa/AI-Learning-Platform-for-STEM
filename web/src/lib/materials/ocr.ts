import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { createWorker } from "tesseract.js";

export type OcrResult = {
  text: string;
  confidence: number;
};

export type OcrPageResult = OcrResult & {
  imageBuffer: Buffer;
};

const DEFAULT_OCR_LANGUAGE = process.env.OCR_LANGUAGE ?? "eng";
const MAX_PDF_OCR_PAGES = Number(process.env.OCR_MAX_PDF_PAGES ?? 30);
const MIN_OCR_TEXT_LENGTH = Number(process.env.OCR_MIN_TEXT_LENGTH ?? 30);
const SHORT_TEXT_CONFIDENCE = Number(process.env.OCR_SHORT_TEXT_CONFIDENCE ?? 85);

export async function runOcrOnImage(buffer: Buffer) {
  const worker = await createWorker(DEFAULT_OCR_LANGUAGE);
  try {
    const result = await worker.recognize(buffer);
    return {
      text: result.data.text ?? "",
      confidence: result.data.confidence ?? 0,
    } satisfies OcrResult;
  } finally {
    await worker.terminate();
  }
}

export async function runOcrOnPdf(buffer: Buffer) {
  const { createCanvas } = await import("@napi-rs/canvas");
  const doc = await pdfjs.getDocument({ data: buffer }).promise;
  const totalPages = doc.numPages;
  const pageCount = Math.min(totalPages, MAX_PDF_OCR_PAGES);
  const results: OcrPageResult[] = [];

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise;
    const pngBuffer = canvas.toBuffer("image/png");
    const result = await runOcrOnImage(pngBuffer);
    results.push({ ...result, imageBuffer: pngBuffer });
  }

  return { results, pageCount, totalPages };
}

export function isLowQualityText(text: string, confidence: number) {
  const trimmed = text.trim();
  if (trimmed.length < MIN_OCR_TEXT_LENGTH && confidence < SHORT_TEXT_CONFIDENCE) {
    return true;
  }
  if (confidence < 60) {
    return true;
  }
  const nonAlpha = trimmed.replace(/[a-z0-9\s]/gi, "");
  const ratio = nonAlpha.length / Math.max(trimmed.length, 1);
  return ratio > 0.55;
}
