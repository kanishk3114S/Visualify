import { test, expect } from "@playwright/test";

test.describe("Phase 6.6: motion system & reduced-motion compliance", () => {
  test("activates progressive motion readiness in standard mode and honors prefers-reduced-motion: reduce", async ({ browser }) => {
    // 1. Standard motion context
    const normalCtx = await browser.newContext({ reducedMotion: "no-preference" });
    const page = await normalCtx.newPage();
    await page.goto("/");
    const motionAttr = await page.evaluate(() => document.documentElement.dataset.motion);
    expect(motionAttr).toBe("ready");

    // Marquee track animates smoothly when not reduced
    const marqueeAnim = await page.locator(".vf-marquee-track").evaluate((el) => getComputedStyle(el).animationName);
    expect(marqueeAnim).toBe("visualify-marquee");
    await normalCtx.close();

    // 2. Reduced-motion context
    const reducedCtx = await browser.newContext({ reducedMotion: "reduce" });
    const reducedPage = await reducedCtx.newPage();
    await reducedPage.goto("/");
    const reducedAttr = await reducedPage.evaluate(() => document.documentElement.dataset.motion ?? null);
    expect(reducedAttr).toBeNull();

    // Under reduced motion, DiagramMarquee switches cleanly to static non-animated grid and reveals stay visible
    await expect(reducedPage.locator(".vf-marquee-track")).toHaveCount(0);
    await expect(reducedPage.getByRole("button", { name: /Pause gallery/i })).toHaveCount(0);

    const hiddenSections = await reducedPage.locator(".vf-reveal").evaluateAll((els) =>
      els.filter((el) => parseFloat(getComputedStyle(el).opacity) < 0.99).length
    );
    expect(hiddenSections).toBe(0);
    await reducedCtx.close();
  });

  test("progressive reveals remain visible even when IntersectionObserver is unavailable", async ({ page }) => {
    await page.addInitScript(() => {
      window.IntersectionObserver = undefined;
    });
    await page.goto("/");
    const motionAttr = await page.evaluate(() => document.documentElement.dataset.motion ?? null);
    expect(motionAttr).toBeNull();
    const invisibleCount = await page.locator(".vf-reveal").evaluateAll((els) =>
      els.filter((el) => parseFloat(getComputedStyle(el).opacity) < 0.99 || getComputedStyle(el).transform !== "none").length
    );
    expect(invisibleCount).toBe(0);
  });
});
