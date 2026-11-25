import { describe, it, expect } from "vitest";
import { validateEditableScene, sanitizeEditableScene, imageDimensions, renderScene } from "../src/index.js";
import { resolveBrowserPath } from "../src/config/env.js";

const rect = (over = {}) => ({ id: "r", type: "rectangle", x: 0, y: 0, width: 100, height: 50, strokeColor: "#1e1e1e", backgroundColor: "transparent", ...over });

describe("validateEditableScene", () => {
  it("accepts generated shapes plus freehand drawings", () => {
    const scene = {
      elements: [rect(), { id: "f", type: "freedraw", x: 5, y: 5, width: 10, height: 10, points: [[0, 0], [3, 4]] }, { id: "t", type: "text", x: 0, y: 0, width: 10, height: 10, text: "hi" }],
    };
    expect(validateEditableScene(scene)).toEqual({ valid: true, errors: [] });
  });

  it.each([
    ["image elements", { elements: [rect({ id: "i", type: "image" })] }, /unsupported type: image/],
    ["embeddables", { elements: [rect({ id: "e", type: "embeddable" })] }, /unsupported type: embeddable/],
    ["embedded files", { elements: [rect()], files: { abc: { dataURL: "data:image/png;base64,AA" } } }, /Embedded files/],
    ["javascript: links", { elements: [rect({ link: "javascript:alert(1)" })] }, /unsafe link/],
    ["data: links", { elements: [rect({ link: "data:text/html,<script>x</script>" })] }, /unsafe link/],
    ["CSS injection in colours", { elements: [rect({ strokeColor: "red;background:url(x)" })] }, /hex color/],
    ["duplicate ids", { elements: [rect(), rect()] }, /Duplicate element id/],
    ["non-finite coordinates", { elements: [rect({ x: Infinity })] }, /finite number/],
    ["huge point arrays", { elements: [{ id: "f", type: "freedraw", x: 0, y: 0, width: 1, height: 1, points: Array.from({ length: 5001 }, () => [0, 0]) }] }, /points array/],
    ["too many elements", { elements: Array.from({ length: 3001 }, (_, i) => rect({ id: `r${i}` })) }, /max element limit/],
    ["a non-object", "nope", /elements array/],
  ])("rejects %s", (_label, scene, re) => {
    const result = validateEditableScene(scene);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(re);
  });

  it("allows https links", () => {
    expect(validateEditableScene({ elements: [rect({ link: "https://example.com/docs" })] }).valid).toBe(true);
  });
});

describe("sanitizeEditableScene", () => {
  it("drops deleted elements, editor UI state and files", () => {
    const out = sanitizeEditableScene({
      elements: [rect(), rect({ id: "gone", isDeleted: true })],
      appState: { viewBackgroundColor: "#fafafa", gridSize: 20, selectedElementIds: { r: true }, collaborators: {}, name: "x" },
      files: { a: {} },
    });
    expect(out.elements.map((e) => e.id)).toEqual(["r"]);
    expect(out.appState).toEqual({ viewBackgroundColor: "#fafafa", gridSize: 20 });
    expect(out.files).toEqual({});
    expect(out).toMatchObject({ type: "excalidraw", version: 2, source: "visualify" });
  });

  it("replaces an unsafe background colour", () => {
    expect(sanitizeEditableScene({ elements: [], appState: { viewBackgroundColor: "url(evil)" } }).appState.viewBackgroundColor).toBe("#ffffff");
  });
});

describe("imageDimensions", () => {
  it("reads PNG IHDR and SVG width/height or viewBox", () => {
    const png = Buffer.alloc(24);
    png.writeUInt32BE(640, 16);
    png.writeUInt32BE(480, 20);
    expect(imageDimensions(png, "png")).toEqual({ width: 640, height: 480 });
    expect(imageDimensions(Buffer.from('<svg xmlns="x" width="300" height="150">'), "svg")).toEqual({ width: 300, height: 150 });
    expect(imageDimensions(Buffer.from('<svg viewBox="0 0 812.5 400">'), "svg")).toEqual({ width: 813, height: 400 });
  });
});

const hasBrowser = Boolean(resolveBrowserPath().path);

describe.skipIf(!hasBrowser)("renderScene themes (real CLI + headless browser)", () => {
  const scene = sanitizeEditableScene({ elements: [rect({ backgroundColor: "#a5d8ff" })], appState: { viewBackgroundColor: "#ffffff" } });

  it("renders dark and transparent PNGs with real dimensions", async () => {
    const light = await renderScene({ sceneJson: scene, format: "png" });
    const dark = await renderScene({ sceneJson: scene, format: "png", theme: "dark" });
    const clear = await renderScene({ sceneJson: scene, format: "png", transparent: true });
    for (const r of [light, dark, clear]) {
      expect(r.width).toBeGreaterThan(50);
      expect(r.height).toBeGreaterThan(20);
    }
    expect(dark.buffer.equals(light.buffer)).toBe(false);
    expect(clear.buffer.equals(light.buffer)).toBe(false);
  }, 60_000);

  it("renders an SVG with dimensions and rejects an unknown theme", async () => {
    const svg = await renderScene({ sceneJson: scene, format: "svg", theme: "dark" });
    expect(svg.buffer.toString("utf8")).toContain("<svg");
    expect(svg.width).toBeGreaterThan(50);
    await expect(renderScene({ sceneJson: scene, format: "png", theme: "neon" })).rejects.toMatchObject({ code: "UNSUPPORTED_THEME" });
  }, 60_000);
});
