import { buildMermaidSource } from "./mermaidAdapter.js";
import { buildComparisonScene, buildMindmapScene } from "./directSceneAdapter.js";
import { styleConvertedScene } from "./diagramTheme.js";
import { convertMermaidToExcalidraw } from "../renderer/cliRenderer.js";
import { validateExcalidrawScene } from "../schemas/excalidrawScene.js";

export const ADAPTER_ROUTING_TABLE = Object.freeze({
  flowchart: "mermaid",
  sequence: "mermaid",
  timeline: "mermaid",
  er_diagram: "mermaid",
  class_diagram: "mermaid",
  mindmap: "direct_scene",
  comparison: "direct_scene",
});

/**
 * Selects the adapter strategy and compiles a validated diagramSpec into
 * a validated Excalidraw scene JSON payload.
 */
export async function compileDiagramSpecToScene(
  diagramSpec,
  { visualStyle = "hand_drawn_clean", mermaidConverter = convertMermaidToExcalidraw, browserPath, timeoutMs, signal } = {}
) {
  if (!diagramSpec || !diagramSpec.kind) {
    throw new Error("diagramSpec with valid kind is required");
  }

  const strategy = ADAPTER_ROUTING_TABLE[diagramSpec.kind];
  if (!strategy) {
    throw new Error(`Unsupported diagramSpec kind: ${diagramSpec.kind}`);
  }

  let scene;
  let mermaidSource = null;
  let conversionLatencyMs = 0;

  if (strategy === "mermaid") {
    mermaidSource = buildMermaidSource(diagramSpec);
    const converted = await mermaidConverter({
      mermaidSource,
      browserPath,
      timeoutMs,
      signal,
    });
    scene = styleConvertedScene(converted.scene, { visualStyle, kind: diagramSpec.kind });
    conversionLatencyMs = converted.latencyMs;
  } else if (diagramSpec.kind === "mindmap") {
    const t0 = Date.now();
    scene = buildMindmapScene(diagramSpec, { visualStyle });
    conversionLatencyMs = Date.now() - t0;
  } else if (diagramSpec.kind === "comparison") {
    const t0 = Date.now();
    scene = buildComparisonScene(diagramSpec, { visualStyle });
    conversionLatencyMs = Date.now() - t0;
  }

  const validation = validateExcalidrawScene(scene);
  if (!validation.valid) {
    throw new Error(
      `Generated Excalidraw scene failed validation: ${validation.errors.join("; ")}`
    );
  }

  return {
    strategy,
    kind: diagramSpec.kind,
    mermaidSource,
    scene,
    conversionLatencyMs,
  };
}
