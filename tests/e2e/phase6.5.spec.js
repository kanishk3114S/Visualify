import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { makeProfile, mockApi, signInWithFakeSession, trackErrors } from "./support/mockBackend.js";
import { createGenerationMock } from "./support/generationMocks.js";
import { createNotesMock, routeStorageDownloads } from "./support/notesMocks.js";

test.describe("Phase 6.5: Admin Metrics, Non-Admin Guard, Quota Refund UX & Visual Audits", () => {
  test("hides Admin metrics nav from non-admins and renders 403 denied Card cleanly", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 860 });
    const errors = trackErrors(page);
    await signInWithFakeSession(page);
    const gens = createGenerationMock({ scenario: "complete" });
    const notes = createNotesMock({ generations: gens });
    await routeStorageDownloads(page);
    await mockApi(page, { profile: makeProfile({ isAdmin: false }), generations: gens, notes });

    await page.goto("/app");
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Admin metrics" })).toBeHidden();

    await page.goto("/app/admin/metrics");
    await expect(page.getByTestId("admin-metrics-forbidden")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Administrator access required" })).toBeVisible();
    expect(errors.filter((e) => !e.includes("403 (Forbidden)"))).toEqual([]);
  });

  test("renders Admin metrics page for admins across windows, themes, viewports, reducedMotion, and passes Axe", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 860 });
    const errors = trackErrors(page);
    await signInWithFakeSession(page);
    const gens = createGenerationMock({ scenario: "complete" });
    const notes = createNotesMock({ generations: gens });
    await routeStorageDownloads(page);
    const state = await mockApi(page, { profile: makeProfile({ isAdmin: true }), generations: gens, notes });

    await page.goto("/app");
    const navLink = page.getByRole("link", { name: "Admin metrics" });
    await expect(navLink).toBeVisible();
    await navLink.click();

    await expect(page).toHaveURL("/app/admin/metrics");
    await expect(page.getByTestId("admin-metrics-page")).toBeVisible();
    await expect(page.getByText("62.5%")).toBeVisible();
    await expect(page.getByText("94.7%")).toBeVisible();
    await expect(page.getByText("4.21s p50")).toBeVisible();

    await page.getByRole("radio", { name: "Last 7 days" }).click();
    await page.getByRole("radio", { name: "Last 90 days" }).click();
    const metricCalls = state.calls.filter((c) => c.path === "/api/v1/admin/metrics");
    expect(metricCalls.length).toBeGreaterThanOrEqual(3);

    for (const vp of [
      { width: 1366, height: 860, tag: "desktop" },
      { width: 1024, height: 768, tag: "tablet" },
      { width: 390, height: 844, tag: "mobile" },
    ]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const theme of ["light", "dark"]) {
        await page.evaluate((mode) => {
          window.localStorage.setItem("visualify:theme", mode);
          document.documentElement.classList.toggle("dark", mode === "dark");
          document.documentElement.style.colorScheme = mode;
        }, theme);
        // Let 150ms CSS color transitions settle before Axe reads computed contrast.
        await page.waitForTimeout(250);
        const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
        expect(axe.violations, `Axe failed on ${vp.tag} (${theme})`).toEqual([]);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `Horizontal overflow on ${vp.tag} (${theme})`).toBe(0);
        if (vp.tag === "desktop" || (vp.tag === "mobile" && theme === "light")) {
          await page.screenshot({ path: `renders/phase65-admin-metrics-${vp.tag}-${theme}.png`, fullPage: false });
        }
      }
    }

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1366, height: 860 });
    await page.goto("/app/admin/metrics");
    const animDur = await page.evaluate(() => {
      const el = document.querySelector("[data-testid='admin-metrics-page']");
      return el ? getComputedStyle(el).animationDuration : "0s";
    });
    expect(parseFloat(animDur)).toBeLessThanOrEqual(0.01);
    expect(errors).toEqual([]);
  });

  test("failed generation refunds usage quota so Dashboard meter excludes failed run", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 860 });
    const errors = trackErrors(page);
    await signInWithFakeSession(page);
    const gens = createGenerationMock({ scenario: "fail" });
    const notes = createNotesMock({ generations: gens });
    await routeStorageDownloads(page);
    await mockApi(page, {
      generations: gens,
      notes,
      usage: {
        periodStart: "2026-11-01T00:00:00.000Z",
        resetsAt: "2026-12-01T00:00:00.000Z",
        limit: 50,
        used: 4,
        remaining: 46,
        breakdown: { generations: 4, companion: 0, exports: 0 },
      },
    });

    await page.goto("/app/create");
    await page.getByLabel(/What do you want to understand\?/i).fill("Explain TCP congestion control with cwnd slow start.");
    await page.getByRole("button", { name: /Generate visual/ }).click();

    await expect(page.getByText(/AI service is busy right now/i)).toBeVisible({ timeout: 10000 });
    await page.goto("/app");
    await expect(page.getByTestId("usage-meter-badge")).toContainText("4 / 50 used");
    expect(errors).toEqual([]);
  });
});
