import { test, expect } from "@playwright/test";

test.describe("Phase 6.6: landing performance, CLS & bundle isolation budget", () => {
  test("landing page avoids Excalidraw bundle, maintains CLS < 0.05, and stays responsive under 4x CPU throttle", async ({ page }) => {
    const requestedUrls = [];
    page.on("request", (req) => requestedUrls.push(req.url()));

    const client = await page.context().newCDPSession(page);
    await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });

    await page.addInitScript(() => {
      window.__vfCls = 0;
      window.__vfLongTasks = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) window.__vfCls += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration > 320) window.__vfLongTasks.push(Math.round(entry.duration));
        }
      }).observe({ type: "longtask", buffered: true });
    });

    await page.goto("/", { waitUntil: "networkidle" });

    // Measure long tasks strictly across user interactions & scroll animations after initial Vite dev boot
    await page.evaluate(() => {
      window.__vfLongTasks = [];
    });

    // Exercise interactive showcase & study demo tabs under 4x CPU throttle
    await page.getByRole("radio", { name: "Flowchart" }).click();
    await page.getByRole("tab", { name: /Draw:/i }).click();
    await page.getByTestId("demo-flashcard").click();

    // Verify scroll + reveal pass adds zero main-thread jank
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.6));
    await page.waitForTimeout(450);

    const { cls, longTasks } = await page.evaluate(() => ({
      cls: window.__vfCls,
      longTasks: window.__vfLongTasks,
    }));

    expect(cls, `Unexpected CLS (${cls}) >= 0.05`).toBeLessThan(0.05);
    expect(longTasks, `Interaction/scroll long tasks exceeded 320ms under 4x StrictMode dev throttle: ${JSON.stringify(longTasks)}`).toEqual([]);

    const excalidrawReqs = requestedUrls.filter((u) => /excalidraw|WorkspaceCanvas|mermaid/i.test(u));
    expect(excalidrawReqs, `Excalidraw/Mermaid must never load on landing: ${excalidrawReqs.join(", ")}`).toEqual([]);
  });
});
