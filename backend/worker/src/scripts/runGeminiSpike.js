import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkerEnv } from "../config/env.js";
import { generateLearningPlan } from "../services/geminiPlanner.js";
import { compileDiagramSpecToScene } from "../adapters/sceneRouter.js";
import { renderScene } from "../renderer/cliRenderer.js";

loadWorkerEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const RENDERS_DIR = path.join(REPO_ROOT, "renders");

const LIVE_PROMPTS = [
  {
    slug: "live-tcp-handshake",
    prompt: "Explain the TCP three-way handshake.",
  },
  {
    slug: "live-db-normalization",
    prompt: "Explain database normalization, including 1NF, 2NF and 3NF.",
  },
];

async function run() {
  await fs.mkdir(RENDERS_DIR, { recursive: true });
  const results = [];

  for (const item of LIVE_PROMPTS) {
    const planResult = await generateLearningPlan({
      prompt: item.prompt,
      timeoutMs: 60_000,
    });

    const sectionResults = [];
    for (const section of planResult.plan.sections) {
      const compiled = await compileDiagramSpecToScene(section.diagramSpec);
      const png = await renderScene({ sceneJson: compiled.scene, format: "png" });
      const svg = await renderScene({ sceneJson: compiled.scene, format: "svg" });

      const base = `${item.slug}-${section.id}`;
      await fs.writeFile(
        path.join(RENDERS_DIR, `${base}.excalidraw`),
        JSON.stringify(compiled.scene, null, 2),
        "utf8"
      );
      await fs.writeFile(path.join(RENDERS_DIR, `${base}.png`), png.buffer);
      await fs.writeFile(path.join(RENDERS_DIR, `${base}.svg`), svg.buffer);

      sectionResults.push({
        sectionId: section.id,
        visualType: section.visualType,
        strategy: compiled.strategy,
        elementCount: compiled.scene.elements.length,
        conversionLatencyMs: compiled.conversionLatencyMs,
        pngBytes: png.bytes,
        pngLatencyMs: png.latencyMs,
        svgBytes: svg.bytes,
        svgLatencyMs: svg.latencyMs,
      });
    }

    results.push({
      slug: item.slug,
      prompt: item.prompt,
      model: planResult.model,
      repaired: planResult.repaired,
      geminiLatencyMs: planResult.latencyMs,
      usageMetadata: planResult.usageMetadata,
      title: planResult.plan.title,
      sections: sectionResults,
    });
  }

  console.log(JSON.stringify({ status: "PASS", results }, null, 2));
}

run().catch((err) => {
  console.error("Live Gemini spike failed:", err.message);
  process.exitCode = 1;
});
