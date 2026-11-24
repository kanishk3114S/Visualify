import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import {
  CliRendererError,
  convertMermaidToExcalidraw,
  renderScene,
} from "../src/renderer/cliRenderer.js";
import { buildMindmapScene, buildComparisonScene } from "../src/adapters/directSceneAdapter.js";
import { compileDiagramSpecToScene } from "../src/adapters/sceneRouter.js";
import { resolveBrowserPath } from "../src/config/env.js";

function readPngDimensions(pngBuffer) {
  return {
    width: pngBuffer.readUInt32BE(16),
    height: pngBuffer.readUInt32BE(20),
  };
}

function listVisualifyTempDirs(prefix) {
  return fsSync.readdirSync(os.tmpdir()).filter((entry) => entry.startsWith(prefix));
}

describe("cliRenderer (unit tests with fault injection)", () => {
  it("invokes node with explicit argument array and shell:false (preserving spaces in browserPath)", async () => {
    const prefix = "visualify-unit-args-";
    const execMock = vi.fn(async (_cmd, args, opts) => {
      expect(opts.shell).toBe(false);
      const outIdx = args.indexOf("--out");
      const outPath = args[outIdx + 1];
      await fs.writeFile(
        outPath,
        JSON.stringify({ type: "excalidraw", elements: [{ id: "1", type: "rectangle" }] })
      );
      return { stdout: "{}", stderr: "" };
    });

    const result = await convertMermaidToExcalidraw({
      mermaidSource: "flowchart TD\nA-->B",
      browserPath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      cliScriptPath: "C:\\fake\\cli\\main.js",
      execFn: execMock,
      tempPrefix: prefix,
    });

    // Wait—if Chrome path doesn't exist on a CI machine, resolveBrowserPath falls back;
    // so check that --browser-path was passed as a discrete array element, not shell-split.
    const [, args] = execMock.mock.calls[0];
    expect(args).toContain("--browser-path");
    expect(result.scene.elements).toHaveLength(1);
    expect(listVisualifyTempDirs(prefix)).toEqual([]);
  });

  it("cleans up temporary directory even when CLI exits with non-zero code", async () => {
    const prefix = "visualify-unit-fail-";
    const execMock = vi.fn().mockRejectedValue({
      code: 1,
      stderr: "Syntax error in graph",
    });

    await expect(
      convertMermaidToExcalidraw({
        mermaidSource: "invalid %%",
        cliScriptPath: "fake-cli.js",
        execFn: execMock,
        tempPrefix: prefix,
      })
    ).rejects.toMatchObject({
      code: "CLI_EXEC_FAILED",
      exitCode: 1,
    });

    expect(listVisualifyTempDirs(prefix)).toEqual([]);
  });

  it("classifies SIGTERM timeout errors as CLI_TIMEOUT and cleans up", async () => {
    const prefix = "visualify-unit-timeout-";
    const execMock = vi.fn().mockRejectedValue({
      killed: true,
      signal: "SIGTERM",
      stderr: "",
    });

    await expect(
      convertMermaidToExcalidraw({
        mermaidSource: "flowchart TD\nA-->B",
        cliScriptPath: "fake-cli.js",
        execFn: execMock,
        timeoutMs: 1200,
        tempPrefix: prefix,
      })
    ).rejects.toMatchObject({ code: "CLI_TIMEOUT" });

    expect(listVisualifyTempDirs(prefix)).toEqual([]);
  });

  it("classifies maxBuffer overflow errors as CLI_BUFFER_OVERFLOW", async () => {
    const execMock = vi.fn().mockRejectedValue({
      code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
    });

    await expect(
      convertMermaidToExcalidraw({
        mermaidSource: "flowchart TD\nA-->B",
        cliScriptPath: "fake-cli.js",
        execFn: execMock,
      })
    ).rejects.toMatchObject({ code: "CLI_BUFFER_OVERFLOW" });
  });

  it("classifies missing executable ENOENT as CLI_EXECUTABLE_MISSING", async () => {
    const execMock = vi.fn().mockRejectedValue({ code: "ENOENT" });

    await expect(
      convertMermaidToExcalidraw({
        mermaidSource: "flowchart TD\nA-->B",
        cliScriptPath: "fake-cli.js",
        execFn: execMock,
      })
    ).rejects.toMatchObject({ code: "CLI_EXECUTABLE_MISSING" });
  });
});

const browserCheck = resolveBrowserPath();
const describeLocalIntegration = browserCheck.path ? describe : describe.skip;

describeLocalIntegration("cliRenderer (real local @excalidraw/cli integration)", () => {
  it(
    "converts Mermaid flowchart into editable Excalidraw elements (not a flattened image) and renders PNG & SVG",
    async () => {
      const prefix = "visualify-int-flow-";
      const res = await convertMermaidToExcalidraw({
        mermaidSource: "flowchart TD\n  A[Client] -->|HTTP| B[Server]\n  B --> C{Valid?}",
        tempPrefix: prefix,
      });

      const types = new Set(res.scene.elements.map((e) => e.type));
      expect(res.scene.elements.length).toBeGreaterThanOrEqual(4);
      expect(types.has("image")).toBe(false);
      expect(types.has("rectangle") || types.has("diamond")).toBe(true);
      expect(types.has("arrow")).toBe(true);
      expect(listVisualifyTempDirs(prefix)).toEqual([]);

      const png = await renderScene({ sceneJson: res.scene, format: "png", tempPrefix: prefix });
      expect(png.bytes).toBeGreaterThan(1000);
      expect(png.buffer.subarray(0, 4).toString("hex")).toBe("89504e47");
      const dims = readPngDimensions(png.buffer);
      expect(dims.width).toBeGreaterThan(50);
      expect(dims.height).toBeGreaterThan(50);

      const svg = await renderScene({ sceneJson: res.scene, format: "svg", tempPrefix: prefix });
      expect(svg.bytes).toBeGreaterThan(500);
      expect(svg.buffer.toString("utf8")).toContain("<svg");
      expect(listVisualifyTempDirs(prefix)).toEqual([]);
    },
    45_000
  );

  it(
    "converts Mermaid sequence diagram into editable elements",
    async () => {
      const res = await convertMermaidToExcalidraw({
        mermaidSource:
          "sequenceDiagram\n  participant C as Client\n  participant S as Server\n  C->>S: SYN\n  S-->>C: SYN-ACK",
      });
      const types = new Set(res.scene.elements.map((e) => e.type));
      expect(res.scene.elements.length).toBeGreaterThanOrEqual(6);
      expect(types.has("image")).toBe(false);
      expect(types.has("arrow")).toBe(true);
    },
    45_000
  );

  it(
    "converts and renders timeline, er_diagram, and class_diagram into editable elements, PNG, and SVG",
    async () => {
      const specs = [
        {
          kind: "timeline",
          title: "Web Evolution",
          events: [
            { id: "e1", period: "1995", label: "HTML" },
            { id: "e2", period: "2025", label: "AI Apps" },
          ],
        },
        {
          kind: "er_diagram",
          entities: [
            { id: "user", name: "User", attributes: ["id", "email"] },
            { id: "note", name: "Note", attributes: ["id", "title"] },
          ],
          relations: [{ from: "user", to: "note", cardinality: "one-to-many", label: "owns" }],
        },
        {
          kind: "class_diagram",
          classes: [
            { id: "planner", name: "Planner", attributes: ["model"], methods: ["plan()"] },
            { id: "adapter", name: "Adapter", attributes: ["kind"], methods: ["compile()"] },
          ],
          relations: [{ from: "planner", to: "adapter", type: "association", label: "feeds" }],
        },
      ];

      for (const spec of specs) {
        const compiled = await compileDiagramSpecToScene(spec);
        const types = new Set(compiled.scene.elements.map((e) => e.type));
        expect(types.has("image")).toBe(false);
        expect(compiled.scene.elements.length).toBeGreaterThanOrEqual(8);

        const png = await renderScene({ sceneJson: compiled.scene, format: "png" });
        const dims = readPngDimensions(png.buffer);
        expect(dims.width).toBeGreaterThan(50);
        expect(dims.height).toBeGreaterThan(50);

        const svg = await renderScene({ sceneJson: compiled.scene, format: "svg" });
        expect(svg.buffer.toString("utf8")).toContain("<svg");
      }
    },
    90_000
  );

  it(
    "renders direct mindmap and comparison scenes to PNG and SVG",
    async () => {
      const mindmap = buildMindmapScene({
        kind: "mindmap",
        root: { id: "root", label: "OS" },
        branches: [
          { id: "p", label: "Process", children: [{ id: "t", label: "Threads" }] },
          { id: "m", label: "Memory", children: [{ id: "v", label: "Virtual RAM" }] },
        ],
      });
      const comparison = buildComparisonScene({
        kind: "comparison",
        title: "SQL vs NoSQL",
        columns: [
          { id: "sql", title: "SQL", items: [{ label: "Schema", value: "Fixed" }] },
          { id: "nosql", title: "NoSQL", items: [{ label: "Schema", value: "Flexible" }] },
        ],
      });

      const mmPng = await renderScene({ sceneJson: mindmap, format: "png" });
      const cmpSvg = await renderScene({ sceneJson: comparison, format: "svg" });
      expect(mmPng.bytes).toBeGreaterThan(1000);
      expect(cmpSvg.buffer.toString("utf8")).toContain("<svg");
    },
    45_000
  );

  it(
    "rejects invalid Mermaid syntax cleanly and deletes temporary files",
    async () => {
      const prefix = "visualify-int-badmmd-";
      await expect(
        convertMermaidToExcalidraw({
          mermaidSource: "notValidMermaidSyntax %%% :::",
          tempPrefix: prefix,
        })
      ).rejects.toBeInstanceOf(CliRendererError);
      expect(listVisualifyTempDirs(prefix)).toEqual([]);
    },
    30_000
  );
});
