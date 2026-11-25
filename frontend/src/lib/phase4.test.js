import { describe, it, expect } from "vitest";
import {
  SOURCE_MAX_BYTES,
  SOURCE_MAX_PDF_PAGES,
  formatBytes,
  formatPageRangeLabel,
  parsePdfPageExpression,
  validateSourceFile,
} from "./sourceFiles.js";
import { GENERATION_OPTIONS, sourceGenerationSchema, toSourceGenerationBody } from "./schemas.js";

describe("Phase 4 frontend source validation & page-range helpers", () => {
  it("validates PDF and image files against type, empty, and 20 MiB limits", () => {
    expect(validateSourceFile(null, "pdf")).toMatch(/Choose a PDF/);
    expect(validateSourceFile({ name: "empty.pdf", type: "application/pdf", size: 0 }, "pdf")).toMatch(/empty/);
    expect(validateSourceFile({ name: "huge.pdf", type: "application/pdf", size: SOURCE_MAX_BYTES + 1 }, "pdf")).toMatch(/20 MB/);
    expect(validateSourceFile({ name: "note.txt", type: "text/plain", size: 500 }, "pdf")).toMatch(/PDF/);
    expect(validateSourceFile({ name: "slides.pdf", type: "application/pdf", size: 2048 }, "pdf")).toBeNull();

    expect(validateSourceFile({ name: "diagram.svg", type: "image/svg+xml", size: 500 }, "image")).toMatch(/JPEG, PNG or WebP/);
    expect(validateSourceFile({ name: "notes.webp", type: "image/webp", size: 500 }, "image")).toBeNull();
  });

  it("parses complex PDF page expressions, deduplicates, sorts, and enforces 100-page cap", () => {
    expect(parsePdfPageExpression("1-3, 5, 2, 10-12", 20)).toEqual({
      valid: true,
      pages: [1, 2, 3, 5, 10, 11, 12],
      error: null,
    });
    expect(parsePdfPageExpression("", 10).valid).toBe(false);
    expect(parsePdfPageExpression("0-3", 10).valid).toBe(false);
    expect(parsePdfPageExpression("8-4", 10).valid).toBe(false);
    expect(parsePdfPageExpression("1-15", 10).valid).toBe(false);
    expect(parsePdfPageExpression("abc", 10).valid).toBe(false);
    expect(parsePdfPageExpression(`1-${SOURCE_MAX_PDF_PAGES + 1}`, 200).valid).toBe(false);
  });

  it("formats file sizes and page range labels cleanly", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
    expect(formatPageRangeLabel({ mode: "all" }, 12)).toBe("All 12 pages");
    expect(formatPageRangeLabel({ startPage: 3, endPage: 7 }, 20)).toBe("Pages 3–7");
    expect(formatPageRangeLabel({ pages: [1, 4, 9] }, 20)).toBe("Pages 1, 4, 9");
  });

  it("includes editorial_color visualStyle and builds PDF/image generation payloads", () => {
    expect(GENERATION_OPTIONS.visualStyle.map(([v]) => v)).toEqual([
      "hand_drawn_clean",
      "editorial_color",
      "minimal",
    ]);
    const parsed = sourceGenerationSchema.parse({
      prompt: "  Focus on chapter 2  ",
      subject: "Operating Systems",
      audienceLevel: "undergraduate",
      detail: "standard",
      visualStyle: "editorial_color",
      preferredOutput: "mindmap",
    });
    expect(
      toSourceGenerationBody({
        inputType: "pdf",
        sourceFileId: "11111111-1111-4111-8111-111111111111",
        pageRange: { mode: "range", startPage: 2, endPage: 5 },
        values: parsed,
      })
    ).toEqual({
      inputType: "pdf",
      sourceFileId: "11111111-1111-4111-8111-111111111111",
      pageRange: { mode: "range", startPage: 2, endPage: 5 },
      prompt: "Focus on chapter 2",
      settings: {
        subject: "Operating Systems",
        audienceLevel: "undergraduate",
        detail: "standard",
        visualStyle: "editorial_color",
        preferredOutput: "mindmap",
      },
    });
  });
});
