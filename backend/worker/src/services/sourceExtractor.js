import { createHash } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

export const SOURCE_MIME_TYPES = Object.freeze([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const DEFAULT_MAX_SOURCE_BYTES = 20 * 1024 * 1024; // 20 MiB (PRD Appendix B)
export const DEFAULT_MAX_PDF_PAGES_STORAGE = 500;
export const DEFAULT_MAX_PDF_PAGES_PER_JOB = 100; // PRD Appendix B
export const DEFAULT_MAX_IMAGE_PIXELS = 20_000_000; // 20 MP (PRD Appendix B)
export const DEFAULT_MAX_IMAGE_EDGE = 2048;
export const MAX_EXTRACTED_TEXT_CHARS = 48_000;
export const MAX_PDF_INLINE_BYTES = 15 * 1024 * 1024;

const EXT_BY_MIME = Object.freeze({
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
});

export class SourceExtractionError extends Error {
  constructor(message, { code = "EXTRACTION_FAILED", status = 422, cause = null } = {}) {
    super(message, { cause });
    this.name = "SourceExtractionError";
    this.code = code;
    this.status = status;
  }
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new SourceExtractionError("Extraction was cancelled", { code: "CANCELLED", status: 499 });
  }
}

/**
 * Parses a page-range specification against totalPages (1-based inclusive).
 * Accepts null/{ mode: "all" }, { startPage, endPage }, { pages }, or { expression: "1-5, 8" }.
 */
export function parsePageRange(input, totalPages, { maxSelected = DEFAULT_MAX_PDF_PAGES_PER_JOB } = {}) {
  if (!Number.isInteger(totalPages) || totalPages < 1) {
    throw new SourceExtractionError("PDF contains no pages.", { code: "CORRUPT_FILE", status: 422 });
  }

  const validateCount = (pages) => {
    if (pages.length === 0) {
      throw new SourceExtractionError("Select at least one PDF page.", { code: "INVALID_PAGE_RANGE", status: 400 });
    }
    if (pages.length > maxSelected) {
      throw new SourceExtractionError(
        `Select at most ${maxSelected} pages per generation (this selection has ${pages.length}).`,
        { code: "PAGE_LIMIT_EXCEEDED", status: 422 }
      );
    }
    return pages;
  };

  if (!input || input.mode === "all") {
    if (totalPages > maxSelected) {
      throw new SourceExtractionError(
        `This PDF has ${totalPages} pages. Select up to ${maxSelected} pages per generation.`,
        { code: "PAGE_LIMIT_EXCEEDED", status: 422 }
      );
    }
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  if (Array.isArray(input.pages)) {
    const unique = [...new Set(input.pages)].sort((a, b) => a - b);
    for (const p of unique) {
      if (!Number.isInteger(p) || p < 1 || p > totalPages) {
        throw new SourceExtractionError(`Page ${p} is outside 1–${totalPages}.`, { code: "INVALID_PAGE_RANGE", status: 400 });
      }
    }
    return validateCount(unique);
  }

  if (input.startPage !== undefined || input.endPage !== undefined) {
    const start = Number(input.startPage);
    const end = Number(input.endPage);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > totalPages) {
      throw new SourceExtractionError(`Page range must be within 1–${totalPages}.`, { code: "INVALID_PAGE_RANGE", status: 400 });
    }
    const pages = [];
    for (let p = start; p <= end; p++) pages.push(p);
    return validateCount(pages);
  }

  if (typeof input.expression === "string" || typeof input === "string") {
    const raw = (typeof input === "string" ? input : input.expression).trim();
    if (!raw) {
      throw new SourceExtractionError("Enter pages or ranges like 1-5, 8.", { code: "INVALID_PAGE_RANGE", status: 400 });
    }
    const selected = new Set();
    for (const part of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
      const m = /^(\d{1,4})(?:\s*-\s*(\d{1,4}))?$/.exec(part);
      if (!m) {
        throw new SourceExtractionError(`Invalid page token "${part}". Use numbers or ranges like 1-5, 8.`, {
          code: "INVALID_PAGE_RANGE",
          status: 400,
        });
      }
      const a = Number(m[1]);
      const b = m[2] !== undefined ? Number(m[2]) : a;
      if (a < 1 || b < a || b > totalPages) {
        throw new SourceExtractionError(`Pages must be between 1 and ${totalPages}.`, {
          code: "INVALID_PAGE_RANGE",
          status: 400,
        });
      }
      for (let p = a; p <= b; p++) {
        selected.add(p);
        if (selected.size > maxSelected) {
          throw new SourceExtractionError(`Select at most ${maxSelected} pages per generation.`, {
            code: "PAGE_LIMIT_EXCEEDED",
            status: 422,
          });
        }
      }
    }
    return validateCount([...selected].sort((a, b) => a - b));
  }

  throw new SourceExtractionError("Invalid page range format.", { code: "INVALID_PAGE_RANGE", status: 400 });
}

async function openPdfDocument(buffer) {
  let loadingTask;
  try {
    loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      verbosity: 0,
      isEvalSupported: false,
      useSystemFonts: true,
    });
    const doc = await loadingTask.promise;
    return {
      doc,
      close: () => Promise.resolve(loadingTask.destroy?.() ?? doc.cleanup?.()).catch(() => {}),
    };
  } catch (err) {
    await loadingTask?.destroy?.().catch?.(() => {});
    const msg = String(err?.message || "");
    if (err?.name === "PasswordException" || /password|encrypted/i.test(msg)) {
      throw new SourceExtractionError(
        "This PDF is password-protected or encrypted. Remove the password and upload it again.",
        { code: "ENCRYPTED_PDF", status: 422, cause: err }
      );
    }
    throw new SourceExtractionError(
      "This PDF could not be read. Make sure it is a valid, uncorrupted PDF file.",
      { code: "CORRUPT_FILE", status: 422, cause: err }
    );
  }
}

/**
 * Validates uploaded source bytes via magic bytes, strips image EXIF/metadata
 * and normalizes orientation/dimensions via Sharp, or inspects PDF page count.
 */
export async function inspectSourceBuffer(
  buffer,
  {
    maxBytes = DEFAULT_MAX_SOURCE_BYTES,
    maxPdfPages = DEFAULT_MAX_PDF_PAGES_STORAGE,
    maxImagePixels = DEFAULT_MAX_IMAGE_PIXELS,
    maxImageEdge = DEFAULT_MAX_IMAGE_EDGE,
  } = {}
) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new SourceExtractionError("Choose a PDF or image file to upload.", { code: "FILE_REQUIRED", status: 400 });
  }
  if (buffer.length > maxBytes) {
    throw new SourceExtractionError("This file exceeds the current upload limit.", { code: "FILE_TOO_LARGE", status: 413 });
  }

  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !SOURCE_MIME_TYPES.includes(detected.mime)) {
    throw new SourceExtractionError("Upload a PDF, JPEG, PNG or WebP file.", {
      code: "UNSUPPORTED_FILE_TYPE",
      status: 415,
    });
  }

  if (detected.mime === "application/pdf") {
    const { doc, close } = await openPdfDocument(buffer);
    try {
      const pageCount = doc.numPages;
      if (!Number.isInteger(pageCount) || pageCount < 1) {
        throw new SourceExtractionError("This PDF contains no readable pages.", { code: "CORRUPT_FILE", status: 422 });
      }
      if (pageCount > maxPdfPages) {
        throw new SourceExtractionError(`PDFs can have at most ${maxPdfPages} pages.`, {
          code: "PAGE_LIMIT_EXCEEDED",
          status: 422,
        });
      }
      const checksum = createHash("sha256").update(buffer).digest("hex");
      return {
        mimeType: "application/pdf",
        ext: "pdf",
        sizeBytes: buffer.length,
        checksum,
        pageCount,
        width: null,
        height: null,
        normalizedBuffer: buffer,
      };
    } finally {
      await close();
    }
  }

  // Image path: decode, validate dimensions, rotate from EXIF, strip metadata
  let meta;
  try {
    meta = await sharp(buffer, { failOn: "error", limitInputPixels: maxImagePixels, animated: false }).metadata();
  } catch (cause) {
    throw new SourceExtractionError("This image could not be read. Try a different file.", {
      code: "CORRUPT_FILE",
      status: 422,
      cause,
    });
  }

  if (!meta.width || !meta.height) {
    throw new SourceExtractionError("This image could not be read. Try a different file.", {
      code: "CORRUPT_FILE",
      status: 422,
    });
  }

  try {
    let pipeline = sharp(buffer, {
      failOn: "error",
      limitInputPixels: maxImagePixels,
      animated: false,
    })
      .rotate()
      .resize({
        width: maxImageEdge,
        height: maxImageEdge,
        fit: "inside",
        withoutEnlargement: true,
      });

    if (detected.mime === "image/jpeg") pipeline = pipeline.jpeg({ quality: 88, mozjpeg: true });
    else if (detected.mime === "image/png") pipeline = pipeline.png({ compressionLevel: 8 });
    else if (detected.mime === "image/webp") pipeline = pipeline.webp({ quality: 86 });

    const { data: normalizedBuffer, info } = await pipeline.toBuffer({ resolveWithObject: true });
    const checksum = createHash("sha256").update(normalizedBuffer).digest("hex");

    return {
      mimeType: detected.mime,
      ext: EXT_BY_MIME[detected.mime],
      sizeBytes: normalizedBuffer.length,
      checksum,
      pageCount: null,
      width: info.width,
      height: info.height,
      normalizedBuffer,
    };
  } catch (cause) {
    throw new SourceExtractionError("This image could not be processed. Try a different file.", {
      code: "CORRUPT_FILE",
      status: 422,
      cause,
    });
  }
}

/**
 * Extracts text per selected page from a PDF (with multimodal PDF fallback for
 * scanned/diagram-heavy PDFs) or prepares a sanitized image inlineData part.
 */
export async function extractSourceContent({
  buffer,
  mimeType,
  pageRange = null,
  maxSelectedPages = DEFAULT_MAX_PDF_PAGES_PER_JOB,
  maxTextChars = MAX_EXTRACTED_TEXT_CHARS,
  maxPdfInlineBytes = MAX_PDF_INLINE_BYTES,
  signal,
} = {}) {
  throwIfAborted(signal);
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new SourceExtractionError("Source file is empty.", { code: "EMPTY_SOURCE", status: 422 });
  }

  if (mimeType === "application/pdf") {
    const { doc, close } = await openPdfDocument(buffer);
    try {
      const pageCount = doc.numPages;
      const selectedPages = parsePageRange(pageRange, pageCount, { maxSelected: maxSelectedPages });
      const pageChunks = [];
      let totalChars = 0;

      for (const pageNum of selectedPages) {
        throwIfAborted(signal);
        const page = await doc.getPage(pageNum);
        const content = await page.getTextContent();
        const text = (content.items ?? [])
          .map((item) => (typeof item?.str === "string" ? item.str : ""))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (text) {
          totalChars += text.length;
          pageChunks.push(`[Page ${pageNum}]\n${text}`);
        } else {
          pageChunks.push(`[Page ${pageNum}]\n[No selectable text on this page]`);
        }
      }

      const avgCharsPerPage = totalChars / selectedPages.length;
      const hasTextLayer = totalChars >= 40;
      const isScannedLikely = avgCharsPerPage < 40;
      const warnings = [];
      const mediaParts = [];

      let textContent = pageChunks.join("\n\n");
      let truncated = false;
      if (textContent.length > maxTextChars) {
        textContent = `${textContent.slice(0, maxTextChars)}\n\n[Truncated after ${maxTextChars.toLocaleString("en-US")} characters]`;
        truncated = true;
        warnings.push("Selected PDF pages were longer than the context budget, so later pages were truncated.");
      }

      if (isScannedLikely) {
        if (buffer.length <= maxPdfInlineBytes) {
          mediaParts.push({
            inlineData: {
              mimeType: "application/pdf",
              data: buffer.toString("base64"),
            },
          });
          warnings.push("This PDF has sparse selectable text (likely scanned or diagram-heavy); visual analysis was used and confidence may be lower on blurry scans.");
        } else if (!hasTextLayer) {
          throw new SourceExtractionError(
            "This scanned PDF has no selectable text and exceeds the 15 MB visual analysis limit. Try selecting fewer pages or exporting as images.",
            { code: "EMPTY_SOURCE", status: 422 }
          );
        } else {
          warnings.push("Some pages appear scanned with limited selectable text.");
        }
      }

      if (!hasTextLayer && mediaParts.length === 0) {
        throw new SourceExtractionError("No readable text or visual content could be extracted from these PDF pages.", {
          code: "EMPTY_SOURCE",
          status: 422,
        });
      }

      return {
        inputType: "pdf",
        pageCount,
        selectedPages,
        textContent,
        hasTextLayer,
        isScannedLikely,
        truncated,
        warnings,
        mediaParts,
        metadata: {
          hasTextLayer,
          isScannedLikely,
          processedPages: selectedPages.length,
          selectedPages,
          truncated,
          extractedChars: totalChars,
        },
      };
    } finally {
      await close();
    }
  }

  if (["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
    const inspected = await inspectSourceBuffer(buffer);
    throwIfAborted(signal);
    return {
      inputType: "image",
      pageCount: null,
      selectedPages: [],
      textContent: "",
      hasTextLayer: false,
      isScannedLikely: false,
      truncated: false,
      warnings: [],
      mediaParts: [
        {
          inlineData: {
            mimeType: inspected.mimeType,
            data: inspected.normalizedBuffer.toString("base64"),
          },
        },
      ],
      metadata: {
        width: inspected.width,
        height: inspected.height,
        mimeType: inspected.mimeType,
      },
    };
  }

  throw new SourceExtractionError("Unsupported source MIME type.", { code: "UNSUPPORTED_FILE_TYPE", status: 415 });
}
