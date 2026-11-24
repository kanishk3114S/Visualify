import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";

test.describe("Phase 0: React + Excalidraw Editor Spike", () => {
  test("renders Excalidraw canvas with non-zero dimensions, sample scene, basic editing, and zero console/page errors", async ({
    page,
  }) => {
    const pageErrors = [];
    const consoleErrors = [];
    const failedResponses = [];

    page.on("pageerror", (error) => {
      pageErrors.push(error.message);
    });
    page.on("response", (response) => {
      if (response.status() >= 400) {
        failedResponses.push(`${response.status()} ${response.url()}`);
      }
    });
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto("/spike/excalidraw");
    await page.waitForTimeout(1500);
    expect(pageErrors, `Page errors: ${pageErrors.join(" | ")}`).toEqual([]);
    expect(
      consoleErrors,
      `Console errors: ${consoleErrors.join(" | ")} | 404s: ${failedResponses.join(" | ")}`
    ).toEqual([]);

    const container = page.getByTestId("excalidraw-container");
    await expect(container).toBeVisible();

    const canvas = container.locator("canvas.interactive").first();
    await expect(canvas).toBeVisible({ timeout: 15_000 });

    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box.width).toBeGreaterThan(300);
    expect(box.height).toBeGreaterThan(300);

    // Verify sample scene loaded via initialData
    await expect(page.getByTestId("element-count")).toHaveText("Elements: 5");

    // Verify basic editing interaction: draw a rectangle using Excalidraw toolbar shortcut ("r")
    await canvas.click({ position: { x: 200, y: 400 } });
    await page.keyboard.press("r");
    await page.mouse.move(box.x + 250, box.y + 380);
    await page.mouse.down();
    await page.mouse.move(box.x + 380, box.y + 460);
    await page.mouse.up();

    await expect(page.getByTestId("element-count")).toHaveText("Elements: 6");

    // Verify external scene JSON loading via initialData remount hook
    const loaded = await page.evaluate(() => {
      return window.__VISUALIFY_LOAD_SCENE__({
        elements: [
          {
            id: "ext-rect-1",
            type: "rectangle",
            x: 100,
            y: 100,
            width: 200,
            height: 80,
            angle: 0,
            strokeColor: "#1e1e1e",
            backgroundColor: "#ffec99",
            fillStyle: "solid",
            strokeWidth: 2,
            strokeStyle: "solid",
            roughness: 1,
            opacity: 100,
            groupIds: [],
            frameId: null,
            roundness: { type: 3 },
            seed: 42,
            version: 1,
            versionNonce: 4242,
            isDeleted: false,
            boundElements: null,
            updated: 1,
            link: null,
            locked: false,
          },
        ],
        appState: { viewBackgroundColor: "#ffffff" },
      });
    });
    expect(loaded).toBe(true);
    await expect(page.getByTestId("element-count")).toHaveText("Elements: 1");

    fs.mkdirSync(path.resolve("renders"), { recursive: true });
    await page.screenshot({ path: path.resolve("renders/excalidraw-spike-editor.png") });

    // Load all 7 PRD generated scenes (Mermaid + Direct Composition) into React Excalidraw
    const spikeScenes = [
      { file: "renders/tcp-handshake.excalidraw", minElements: 10 },
      { file: "renders/http-request-flow.excalidraw", minElements: 10 },
      { file: "renders/os-concepts-mindmap.excalidraw", minElements: 15 },
      { file: "renders/sql-vs-nosql-comparison.excalidraw", minElements: 10 },
      { file: "renders/timeline-evolution.excalidraw", minElements: 10 },
      { file: "renders/er-data-model.excalidraw", minElements: 10 },
      { file: "renders/class-architecture.excalidraw", minElements: 10 },
    ];

    for (const item of spikeScenes) {
      const fullPath = path.resolve(item.file);
      if (!fs.existsSync(fullPath)) continue;
      const sceneJson = JSON.parse(fs.readFileSync(fullPath, "utf8"));
      const ok = await page.evaluate((payload) => window.__VISUALIFY_LOAD_SCENE__(payload), sceneJson);
      expect(ok).toBe(true);
      await expect(page.getByTestId("element-count")).toHaveText(
        `Elements: ${sceneJson.elements.length}`
      );
      expect(sceneJson.elements.length).toBeGreaterThanOrEqual(item.minElements);
    }

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
