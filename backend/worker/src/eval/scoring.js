/**
 * Deterministic scoring and report formatting for the PRD §14.2 AI evaluation harness.
 * Pure functions only — unit-tested offline without network access.
 */

export const MAX_LEGIBLE_LABEL_CHARS = 120;

export const PRD_RUBRIC_DIMENSIONS = Object.freeze([
  { key: "correctness", name: "Correctness", question: "Are facts, labels, relationships and sequences accurate to the source?" },
  { key: "coverage", name: "Coverage", question: "Are the important concepts represented?" },
  { key: "hierarchy", name: "Hierarchy", question: "Can a student understand the reading order?" },
  { key: "legibility", name: "Legibility", question: "Can the text be read at normal zoom without clipping or tiny dense paragraphs?" },
  { key: "visualFit", name: "Visual fit", question: "Does the chosen diagram type match the concept (timeline, sequence, comparison, etc.)?" },
  { key: "editability", name: "Editability", question: "Does the output remain a useful editable scene of shapes, arrows, and labels?" },
  { key: "traceability", name: "Traceability", question: "Can users see which source page or image supports a concept?" },
]);

/** Extracts text length metrics across composed Excalidraw elements cleanly. */
export function inspectSceneTextMetrics(sceneJson) {
  const elements = Array.isArray(sceneJson?.elements) ? sceneJson.elements.filter((el) => el && !el.isDeleted) : [];
  const textElements = elements.filter((el) => el.type === "text");
  let longestTextLabelChars = 0;
  const overLimitLabels = [];

  for (const el of textElements) {
    const raw = typeof el.text === "string" ? el.text.trim() : "";
    const len = raw.length;
    if (len > longestTextLabelChars) longestTextLabelChars = len;
    if (len > MAX_LEGIBLE_LABEL_CHARS) {
      overLimitLabels.push({ id: el.id, chars: len });
    }
  }

  return {
    elementCount: elements.length,
    textElementCount: textElements.length,
    longestTextLabelChars,
    overLimitLabelCount: overLimitLabels.length,
    hasOverLongLabel: overLimitLabels.length > 0,
  };
}

/**
 * Computes automatic PRD §14.2 quality metrics for one evaluation fixture result.
 */
export function scoreFixtureOutcome({ fixture, planResult = null, sceneJson = null, totalLatencyMs = 0, error = null }) {
  const isSource = fixture.inputType === "pdf" || fixture.inputType === "image";
  if (error || !planResult?.plan) {
    return {
      fixtureId: fixture.id,
      inputType: fixture.inputType ?? "prompt",
      domain: fixture.domain,
      expectedVisualType: fixture.expectedVisualType,
      status: "failed",
      schemaStatus: "failed",
      visualTypesProduced: [],
      visualTypeFits: false,
      sectionCount: 0,
      elementCount: 0,
      textElementCount: 0,
      longestTextLabelChars: 0,
      hasOverLongLabel: false,
      sourceRefsCoverage: isSource ? 0 : null,
      plannerLatencyMs: planResult?.latencyMs ?? null,
      totalLatencyMs,
      promptTokens: planResult?.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: planResult?.usageMetadata?.candidatesTokenCount ?? 0,
      totalTokens: planResult?.usageMetadata?.totalTokenCount ?? 0,
      errorCode: error?.code ?? error?.status ?? "EVAL_FAILED",
      errorMessage: String(error?.message ?? error ?? "").slice(0, 180),
    };
  }

  const sections = planResult.plan.sections ?? [];
  const visualTypesProduced = sections.map((s) => s.visualType);
  const acceptable = Array.isArray(fixture.acceptableVisualTypes) && fixture.acceptableVisualTypes.length
    ? fixture.acceptableVisualTypes
    : [fixture.expectedVisualType];
  const visualTypeFits = visualTypesProduced.some((vt) => acceptable.includes(vt));
  const textMetrics = inspectSceneTextMetrics(sceneJson);

  let sourceRefsCoverage = null;
  if (isSource) {
    const withRefs = sections.filter((s) => Array.isArray(s.sourceRefs) && s.sourceRefs.length > 0).length;
    sourceRefsCoverage = sections.length > 0 ? Number((withRefs / sections.length).toFixed(4)) : 0;
  }

  return {
    fixtureId: fixture.id,
    inputType: fixture.inputType ?? "prompt",
    domain: fixture.domain,
    expectedVisualType: fixture.expectedVisualType,
    status: "passed",
    schemaStatus: planResult.repaired ? "after_repair" : "first_try",
    actualModel: planResult.model ?? null,
    visualTypesProduced,
    visualTypeFits,
    sectionCount: sections.length,
    ...textMetrics,
    sourceRefsCoverage,
    plannerLatencyMs: planResult.latencyMs ?? 0,
    totalLatencyMs,
    promptTokens: planResult.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: planResult.usageMetadata?.candidatesTokenCount ?? 0,
    totalTokens: planResult.usageMetadata?.totalTokenCount ?? 0,
    errorCode: null,
    errorMessage: null,
  };
}

function percentile(values, pct) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
  return Math.round(sorted[idx]);
}

/** Aggregates per-fixture results into model comparison metrics. */
export function aggregateModelSummary({ model, date, results }) {
  const total = results.length;
  const firstTry = results.filter((r) => r.schemaStatus === "first_try").length;
  const afterRepair = results.filter((r) => r.schemaStatus === "after_repair").length;
  const failed = results.filter((r) => r.schemaStatus === "failed").length;
  const succeeded = firstTry + afterRepair;

  const passedRows = results.filter((r) => r.status === "passed");
  const visualFitCount = passedRows.filter((r) => r.visualTypeFits).length;
  const overLongCount = passedRows.filter((r) => r.hasOverLongLabel).length;
  const sourceRows = results.filter((r) => r.sourceRefsCoverage !== null);
  const avgSourceCoverage = sourceRows.length
    ? Number((sourceRows.reduce((a, r) => a + r.sourceRefsCoverage, 0) / sourceRows.length).toFixed(4))
    : null;

  const plannerLatencies = passedRows.map((r) => r.plannerLatencyMs).filter((n) => typeof n === "number");
  const totalLatencies = passedRows.map((r) => r.totalLatencyMs).filter((n) => typeof n === "number");
  const avgElements = passedRows.length
    ? Number((passedRows.reduce((a, r) => a + r.elementCount, 0) / passedRows.length).toFixed(1))
    : 0;
  const maxLabelChars = passedRows.reduce((m, r) => Math.max(m, r.longestTextLabelChars), 0);

  return {
    model,
    date,
    totalFixtures: total,
    schemaFirstTry: firstTry,
    schemaAfterRepair: afterRepair,
    schemaFailed: failed,
    schemaValidRate: total > 0 ? Number((succeeded / total).toFixed(4)) : 0,
    visualFitRate: succeeded > 0 ? Number((visualFitCount / succeeded).toFixed(4)) : 0,
    avgSectionCount: succeeded > 0 ? Number((passedRows.reduce((a, r) => a + r.sectionCount, 0) / succeeded).toFixed(2)) : 0,
    avgElementCount: avgElements,
    maxLabelChars,
    overLongLabelFixtures: overLongCount,
    avgSourceRefsCoverage: avgSourceCoverage,
    plannerLatencyP50Ms: percentile(plannerLatencies, 50),
    plannerLatencyP95Ms: percentile(plannerLatencies, 95),
    totalLatencyP50Ms: percentile(totalLatencies, 50),
    totalLatencyP95Ms: percentile(totalLatencies, 95),
    totalPromptTokens: results.reduce((a, r) => a + (r.promptTokens ?? 0), 0),
    totalOutputTokens: results.reduce((a, r) => a + (r.outputTokens ?? 0), 0),
    totalTokens: results.reduce((a, r) => a + (r.totalTokens ?? 0), 0),
    unavailable503Count: results.filter((r) => r.errorCode === "PROVIDER_TRANSIENT_ERROR" || r.errorCode === 503).length,
  };
}

export function renderMarkdownReport({ summary, results }) {
  const pct = (v) => (v === null || v === undefined ? "n/a" : `${(v * 100).toFixed(1)}%`);
  const lines = [
    `# AI Quality Evaluation — ${summary.model} (${summary.date})`,
    "",
    `- **Fixtures:** ${summary.totalFixtures}`,
    `- **Schema valid (1st try / repair / failed):** ${summary.schemaFirstTry} / ${summary.schemaAfterRepair} / ${summary.schemaFailed} (**${pct(summary.schemaValidRate)}**)`,
    `- **Visual type fit rate (among succeeded):** ${pct(summary.visualFitRate)}`,
    `- **Avg sections / elements:** ${summary.avgSectionCount} sections, ${summary.avgElementCount} elements`,
    `- **Longest label (>120 flagged):** ${summary.maxLabelChars} chars (${summary.overLongLabelFixtures} flagged)`,
    `- **Source refs coverage (PDF + Image):** ${pct(summary.avgSourceRefsCoverage)}`,
    `- **Planner latency (p50 / p95):** ${summary.plannerLatencyP50Ms ?? "n/a"} ms / ${summary.plannerLatencyP95Ms ?? "n/a"} ms`,
    `- **Total end-to-end latency (p50 / p95):** ${summary.totalLatencyP50Ms ?? "n/a"} ms / ${summary.totalLatencyP95Ms ?? "n/a"} ms`,
    `- **Tokens (prompt / output / total):** ${summary.totalPromptTokens} / ${summary.totalOutputTokens} / ${summary.totalTokens}`,
    `- **503 Unavailable errors:** ${summary.unavailable503Count}`,
    "",
    "| Fixture | Type | Domain | Schema | Fit | Sections | Elements | Text Els | Max Label | Source Refs | Planner ms | Total ms | Error |",
    "| :--- | :--- | :--- | :--- | :---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :--- |",
  ];

  for (const r of results) {
    lines.push(
      `| \`${r.fixtureId}\` | ${r.inputType} | ${r.domain} | ${r.schemaStatus} | ${r.visualTypeFits ? "yes" : "no"} | ${r.sectionCount} | ${r.elementCount} | ${r.textElementCount} | ${r.longestTextLabelChars}${r.hasOverLongLabel ? "!" : ""} | ${r.sourceRefsCoverage === null ? "—" : pct(r.sourceRefsCoverage)} | ${r.plannerLatencyMs ?? "—"} | ${r.totalLatencyMs} | ${r.errorCode ?? "—"} |`
    );
  }
  return `${lines.join("\n")}\n`;
}

export function renderRubricTemplate(fixtures) {
  const lines = [
    "# PRD §14.2 Human AI Visual Quality Rubric",
    "",
    "Score each dimension from **1** (unusable) to **5** (publication-grade) after reviewing generated scenes.",
    "",
    "## Scoring Dimensions",
    "",
    ...PRD_RUBRIC_DIMENSIONS.map((d, i) => `${i + 1}. **${d.name}** — ${d.question}`),
    "",
    "## Evaluation Sheet",
    "",
    "| Fixture | Input | Expected Type | Correctness (1-5) | Coverage (1-5) | Hierarchy (1-5) | Legibility (1-5) | Visual fit (1-5) | Editability (1-5) | Traceability (1-5) | Reviewer Notes |",
    "| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |",
  ];

  for (const f of fixtures) {
    lines.push(`| \`${f.id}\` | ${f.inputType ?? "prompt"} | ${f.expectedVisualType} | | | | | | | ${f.inputType === "prompt" ? "N/A" : ""} | |`);
  }
  return `${lines.join("\n")}\n`;
}
