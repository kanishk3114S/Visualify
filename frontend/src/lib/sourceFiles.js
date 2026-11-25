/**
 * Client-side source file validation and PDF page-range parser (UX only; the
 * API and worker validate magic bytes, size, and page bounds independently).
 */

export const SOURCE_MAX_BYTES = 20 * 1024 * 1024; // 20 MiB
export const SOURCE_MAX_PDF_PAGES = 100;

export const PDF_MIME_TYPES = Object.freeze(["application/pdf"]);
export const IMAGE_MIME_TYPES = Object.freeze(["image/jpeg", "image/png", "image/webp"]);

/** Validates a selected file before uploading to /api/v1/sources/upload. */
export function validateSourceFile(file, inputType) {
  if (!file) return `Choose a ${inputType === "pdf" ? "PDF document" : "JPEG, PNG or WebP image"} to upload.`;
  if (file.size === 0) return "That file is empty.";
  if (file.size > SOURCE_MAX_BYTES) return "Files must be 20 MB or smaller.";
  if (inputType === "pdf") {
    const looksPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name ?? "");
    if (!looksPdf) return "Choose a PDF document (.pdf).";
  } else if (inputType === "image") {
    const looksImg = IMAGE_MIME_TYPES.includes(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name ?? "");
    if (!looksImg) return "Choose a JPEG, PNG or WebP image.";
  }
  return null;
}

/** Parses expressions like "1-5, 8, 12-15" into sorted unique pages within 1..totalPages. */
export function parsePdfPageExpression(expression, totalPages, maxSelected = SOURCE_MAX_PDF_PAGES) {
  const raw = String(expression ?? "").trim();
  if (!raw) return { valid: false, pages: [], error: "Enter pages or ranges, e.g. 1-5, 8, 12-15." };
  if (!Number.isInteger(totalPages) || totalPages < 1) {
    return { valid: false, pages: [], error: "PDF page count is unavailable." };
  }

  const selected = new Set();
  const tokens = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (tokens.length === 0) {
    return { valid: false, pages: [], error: "Enter pages or ranges, e.g. 1-5, 8." };
  }

  for (const part of tokens) {
    const match = /^(\d{1,4})(?:\s*-\s*(\d{1,4}))?$/.exec(part);
    if (!match) {
      return { valid: false, pages: [], error: `Invalid page token "${part}". Use numbers or ranges like 1-5, 8.` };
    }
    const start = Number(match[1]);
    const end = match[2] !== undefined ? Number(match[2]) : start;
    if (start < 1 || end < start || end > totalPages) {
      return { valid: false, pages: [], error: `Pages must be between 1 and ${totalPages}.` };
    }
    for (let p = start; p <= end; p++) {
      selected.add(p);
      if (selected.size > maxSelected) {
        return { valid: false, pages: [], error: `Select at most ${maxSelected} pages per generation.` };
      }
    }
  }

  return { valid: true, pages: [...selected].sort((a, b) => a - b), error: null };
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatPageRangeLabel(pageRange, pageCount) {
  if (!pageRange) return pageCount ? `All ${pageCount} pages` : "All pages";
  if (pageRange.mode === "all") return pageCount ? `All ${pageCount} pages` : "All pages";
  if (pageRange.startPage && pageRange.endPage) {
    return pageRange.startPage === pageRange.endPage
      ? `Page ${pageRange.startPage}`
      : `Pages ${pageRange.startPage}–${pageRange.endPage}`;
  }
  if (Array.isArray(pageRange.pages) && pageRange.pages.length) {
    if (pageRange.pages.length <= 4) return `Pages ${pageRange.pages.join(", ")}`;
    return `${pageRange.pages.length} selected pages`;
  }
  if (pageRange.expression) return `Pages ${pageRange.expression}`;
  return pageCount ? `${pageCount} pages` : "Selected pages";
}
