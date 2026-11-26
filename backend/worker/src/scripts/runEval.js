import fs from "node:fs/promises";
import path from "node:path";
import { loadWorkerEnv } from "../config/env.js";
import { generateLearningPlan } from "../services/geminiPlanner.js";
import { compileDiagramSpecToScene } from "../adapters/sceneRouter.js";
import { composeLessonScene } from "../adapters/sceneComposer.js";
import { extractSourceContent } from "../services/sourceExtractor.js";
import {
  aggregateModelSummary,
  renderMarkdownReport,
  renderRubricTemplate,
  scoreFixtureOutcome,
} from "../eval/scoring.js";

const WORKER_ROOT = path.resolve(import.meta.dirname, "../..");
const REPO_ROOT = path.resolve(WORKER_ROOT, "../..");
const EVAL_DIR = path.join(WORKER_ROOT, "eval");
const DOCS_EVAL_DIR = path.join(REPO_ROOT, "docs", "eval");

function parseArgs(argv) {
  const models = [];
  let delayMs = 500;
  let limit = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--model" && argv[i + 1]) {
      models.push(argv[++i].trim());
    } else if (a === "--delay" && argv[i + 1]) {
      delayMs = Math.max(0, Number(argv[++i]) || 0);
    } else if (a === "--limit" && argv[i + 1]) {
      limit = Math.max(1, Number(argv[++i]) || 1);
    } else if (/^gemini-[a-z0-9.-]+$/i.test(a)) {
      models.push(a.trim());
    } else if (/^\d+$/.test(a)) {
      delayMs = Math.max(0, Number(a));
    }
  }
  return {
    models: models.length ? models : [process.env.GEMINI_MODEL || "gemini-3.5-flash-lite"],
    delayMs,
    limit,
  };
}

async function loadAllFixtures(limit = null) {
  const prompts = JSON.parse(await fs.readFile(path.join(EVAL_DIR, "prompts.json"), "utf8")).map((p) => ({
    ...p,
    inputType: "prompt",
  }));
  const sources = JSON.parse(await fs.readFile(path.join(EVAL_DIR, "sources", "sources.json"), "utf8"));
  const all = [...prompts, ...sources];
  return limit ? all.slice(0, limit) : all;
}

async function runSingleFixture(fixture, model) {
  const startedAt = Date.now();
  try {
    let extractedSource = null;
    if (fixture.inputType === "pdf" || fixture.inputType === "image") {
      const filePath = path.join(EVAL_DIR, "sources", fixture.file);
      const buffer = await fs.readFile(filePath);
      extractedSource = await extractSourceContent({
        buffer,
        mimeType: fixture.mimeType,
        maxSelectedPages: 10,
      });
    }

    const planResult = await generateLearningPlan({
      inputType: fixture.inputType,
      prompt: fixture.prompt ?? "",
      extractedSource,
      model,
      fallbackModels: [], // Evaluate this specific model accurately without silent failover
      maxTransientRetries: 0,
      timeoutMs: 30_000,
    });

    const parts = [];
    for (const [idx, sec] of planResult.plan.sections.entries()) {
      const compiled = await compileDiagramSpecToScene(sec.diagramSpec);
      parts.push({
        sectionId: sec.id,
        title: sec.title,
        frameName: `${idx + 1}. ${sec.title}`,
        visualType: sec.visualType,
        scene: compiled.scene,
      });
    }
    const sceneJson = composeLessonScene(parts);
    return scoreFixtureOutcome({
      fixture,
      planResult,
      sceneJson,
      totalLatencyMs: Date.now() - startedAt,
    });
  } catch (err) {
    return scoreFixtureOutcome({
      fixture,
      totalLatencyMs: Date.now() - startedAt,
      error: err,
    });
  }
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.error("Refusing to run AI quality evaluation in NODE_ENV=production.");
    process.exit(1);
  }

  // Load worker env + API env fallback without ever printing secret values
  const apiEnvLocal = path.join(REPO_ROOT, "backend", ".env.local");
  const { default: dotenv } = await import("dotenv");
  try {
    await fs.access(apiEnvLocal);
    dotenv.config({ path: apiEnvLocal, override: false, quiet: true });
  } catch {}
  loadWorkerEnv();

  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey || /YOUR_/i.test(apiKey)) {
    console.error("GEMINI_API_KEY is missing. Set a server-side key in backend/.env.local before running eval:quality.");
    process.exit(1);
  }

  const { models, delayMs, limit } = parseArgs(process.argv.slice(2));
  const fixtures = await loadAllFixtures(limit);
  const dateStr = new Date().toISOString().slice(0, 10);
  await fs.mkdir(DOCS_EVAL_DIR, { recursive: true });

  // Write/refresh human rubric sheet
  await fs.writeFile(path.join(DOCS_EVAL_DIR, "rubric-template.md"), renderRubricTemplate(fixtures), "utf8");

  const modelSummaries = [];
  for (const model of models) {
    console.log(`Evaluating ${fixtures.length} fixtures on model ${model}...`);
    const results = [];
    for (const fixture of fixtures) {
      const res = await runSingleFixture(fixture, model);
      results.push(res);
      console.log(`  [${model}] ${fixture.id}: ${res.schemaStatus} (${res.totalLatencyMs}ms)${res.errorCode ? ` [${res.errorCode}]` : ""}`);
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    }

    const summary = aggregateModelSummary({ model, date: dateStr, results });
    modelSummaries.push(summary);

    const safeSlug = model.replace(/[^a-zA-Z0-9._-]/g, "_");
    await fs.writeFile(
      path.join(DOCS_EVAL_DIR, `${dateStr}-${safeSlug}.json`),
      JSON.stringify({ summary, results }, null, 2),
      "utf8"
    );
    await fs.writeFile(
      path.join(DOCS_EVAL_DIR, `${dateStr}-${safeSlug}.md`),
      renderMarkdownReport({ summary, results }),
      "utf8"
    );
  }

  console.log(JSON.stringify({ status: "COMPLETE", summaries: modelSummaries }, null, 2));
}

main().catch((err) => {
  console.error("eval:quality failed:", err.message);
  process.exit(1);
});
