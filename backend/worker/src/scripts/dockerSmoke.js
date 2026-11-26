import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compileDiagramSpecToScene } from "../adapters/sceneRouter.js";
import { composeLessonScene } from "../adapters/sceneComposer.js";
import { renderScene } from "../renderer/cliRenderer.js";
import { resolveBrowserPath } from "../config/env.js";

/**
 * Container smoke script (PRD §16.2): compiles and renders one diagram fixture
 * inside a non-root directory to verify Chromium + fonts + Excalidraw CLI.
 */
async function main() {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "visualify-smoke-"));
  const browserPath = resolveBrowserPath();
  const compiled = await compileDiagramSpecToScene(
    {
      kind: "sequence",
      participants: [
        { id: "client", label: "Client" },
        { id: "server", label: "Server" },
      ],
      messages: [
        { from: "client", to: "server", label: "SYN" },
        { from: "server", to: "client", label: "SYN-ACK" },
      ],
    },
    { browserPath, visualStyle: "hand_drawn_clean" }
  );

  const scene = composeLessonScene([
    { sectionId: "smoke", title: "Docker Render Smoke", visualType: "sequence", scene: compiled.scene },
  ]);

  const png = await renderScene({ sceneJson: scene, format: "png", theme: "light", browserPath });
  const svg = await renderScene({ sceneJson: scene, format: "svg", theme: "dark", browserPath });
  await fs.writeFile(path.join(outDir, "smoke.png"), png.buffer);
  await fs.writeFile(path.join(outDir, "smoke.svg"), svg.buffer);

  console.log(
    JSON.stringify({
      status: "PASS",
      elements: scene.elements.length,
      pngBytes: png.bytes,
      svgBytes: svg.bytes,
    })
  );
  await fs.rm(outDir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error("Docker render smoke failed:", err?.message ?? err);
  process.exit(1);
});
