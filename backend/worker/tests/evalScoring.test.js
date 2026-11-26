import { describe, it, expect } from "vitest";
import {
  aggregateModelSummary,
  inspectSceneTextMetrics,
  renderMarkdownReport,
  renderRubricTemplate,
  scoreFixtureOutcome,
} from "../src/eval/scoring.js";

describe("Phase 6.5 §2: AI evaluation scoring and reporting", () => {
  it("inspects element counts, text element counts, and flags over-120 char shape labels", () => {
    const m = inspectSceneTextMetrics({
      elements: [
        { id: "r1", type: "rectangle" },
        { id: "t1", type: "text", text: "Short node" },
        { id: "t2", type: "text", text: "A".repeat(135) },
        { id: "t3", type: "text", text: "Deleted", isDeleted: true },
      ],
    });
    expect(m).toEqual({
      elementCount: 3,
      textElementCount: 2,
      longestTextLabelChars: 135,
      overLimitLabelCount: 1,
      hasOverLongLabel: true,
    });
  });

  it("scores prompt and source fixtures (first_try, after_repair, failed) and aggregates summaries cleanly", () => {
    const promptFixture = { id: "p1", inputType: "prompt", domain: "networking", expectedVisualType: "sequence" };
    const pdfFixture = { id: "pdf1", inputType: "pdf", domain: "databases", expectedVisualType: "comparison" };

    const r1 = scoreFixtureOutcome({
      fixture: promptFixture,
      totalLatencyMs: 3200,
      planResult: {
        repaired: false,
        latencyMs: 2100,
        model: "gemini-3.5-flash-lite",
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 200, totalTokenCount: 300 },
        plan: { sections: [{ id: "s1", visualType: "sequence", sourceRefs: [] }] },
      },
      sceneJson: { elements: [{ id: "a", type: "rectangle" }, { id: "t", type: "text", text: "Client" }] },
    });
    expect(r1.schemaStatus).toBe("first_try");
    expect(r1.visualTypeFits).toBe(true);
    expect(r1.sourceRefsCoverage).toBeNull();

    const r2 = scoreFixtureOutcome({
      fixture: pdfFixture,
      totalLatencyMs: 4100,
      planResult: {
        repaired: true,
        latencyMs: 2900,
        model: "gemini-3.5-flash-lite",
        usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 300, totalTokenCount: 500 },
        plan: {
          sections: [
            { id: "s1", visualType: "comparison", sourceRefs: [{ page: 1, snippet: "x" }] },
            { id: "s2", visualType: "flowchart", sourceRefs: [] },
          ],
        },
      },
      sceneJson: { elements: [{ id: "b", type: "rectangle" }] },
    });
    expect(r2.schemaStatus).toBe("after_repair");
    expect(r2.sourceRefsCoverage).toBe(0.5);

    const r3 = scoreFixtureOutcome({
      fixture: promptFixture,
      totalLatencyMs: 6000,
      error: Object.assign(new Error("high demand"), { code: "PROVIDER_TRANSIENT_ERROR" }),
    });
    expect(r3.schemaStatus).toBe("failed");
    expect(r3.errorCode).toBe("PROVIDER_TRANSIENT_ERROR");

    const summary = aggregateModelSummary({ model: "gemini-3.5-flash-lite", date: "2026-11-26", results: [r1, r2, r3] });
    expect(summary.totalFixtures).toBe(3);
    expect(summary.schemaFirstTry).toBe(1);
    expect(summary.schemaAfterRepair).toBe(1);
    expect(summary.schemaFailed).toBe(1);
    expect(summary.schemaValidRate).toBe(0.6667);
    expect(summary.unavailable503Count).toBe(1);
    expect(summary.totalTokens).toBe(800);

    const md = renderMarkdownReport({ summary, results: [r1, r2, r3] });
    expect(md).toContain("AI Quality Evaluation — gemini-3.5-flash-lite");
    const rubric = renderRubricTemplate([promptFixture, pdfFixture]);
    expect(rubric).toContain("Traceability");
  });
});
