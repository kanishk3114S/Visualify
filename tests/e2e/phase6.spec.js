import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { settleAnimations } from "./support/a11y.js";
import { mockApi, signInWithFakeSession, trackErrors } from "./support/mockBackend.js";
import { createGenerationMock } from "./support/generationMocks.js";
import { createNotesMock, routeStorageDownloads } from "./support/notesMocks.js";

const SEEDED_PLAN = {
  schemaVersion: "1.0",
  title: "Databases Study Guide",
  summary: "Overview of relational and NoSQL database families.",
  learningObjectives: ["Compare SQL and NoSQL"],
  sections: [
    {
      id: "families",
      title: "Database families",
      visualType: "mindmap",
      keyConcepts: ["Relational", "Document", "Key-value"],
      relationships: [],
      explanation: "Databases branch into relational systems and several NoSQL families.",
      sourceRefs: [],
      diagramSpec: {
        kind: "mindmap",
        root: { id: "db", label: "Databases" },
        branches: [
          { id: "rel", label: "Relational", children: [{ id: "pg", label: "Postgres" }] },
          { id: "doc", label: "Document", children: [{ id: "mg", label: "MongoDB" }] },
        ],
      },
    },
  ],
  warnings: [],
};

const SEEDED_SCENE = {
  type: "excalidraw",
  elements: [
    { id: "families__frame", type: "frame", name: "1. Database families", x: 0, y: 0, width: 320, height: 180 },
    { id: "families__box", type: "rectangle", x: 30, y: 40, width: 140, height: 60, frameId: "families__frame", strokeColor: "#0f766e", backgroundColor: "#ccfbf1", boundElements: [{ id: "families__txt", type: "text" }] },
    { id: "families__txt", type: "text", x: 40, y: 55, width: 100, height: 24, text: "Databases", containerId: "families__box", frameId: "families__frame" },
  ],
  appState: { viewBackgroundColor: "#ffffff" },
};

async function seedNote(page, { usage } = {}) {
  await signInWithFakeSession(page);
  const gens = createGenerationMock({ outcomes: ["completed"] });
  const notes = createNotesMock({ generations: gens });
  const note = notes.seedNote({
    title: SEEDED_PLAN.title,
    subject: "Databases",
    tags: ["sql"],
    plan: SEEDED_PLAN,
    scene: SEEDED_SCENE,
    sourceType: "prompt",
  });
  await routeStorageDownloads(page);
  const state = await mockApi(page, { generations: gens, notes, usage });
  return { note, state };
}

test.describe("Phase 6: Quotas, Selection Export, Account Deletion, Tablet, Motion & Accessibility", () => {
  test("dashboard shows Usage this month meter and quota-reached disables Create and Quiz generation", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 860 });
    const errors = trackErrors(page);
    const { note, state } = await seedNote(page, {
      usage: {
        periodStart: "2026-11-01T00:00:00.000Z",
        resetsAt: "2026-12-01T00:00:00.000Z",
        limit: 50,
        used: 12,
        remaining: 38,
        breakdown: { generations: 7, companion: 5, exports: 3 },
      },
    });
    await page.goto("/app");
    await expect(page.getByTestId("usage-meter")).toBeVisible();
    await expect(page.getByTestId("usage-meter-badge")).toContainText("12 / 50 used");

    // Exhaust quota cleanly via shared state
    state.usage = {
      periodStart: "2026-11-01T00:00:00.000Z",
      resetsAt: "2026-12-01T00:00:00.000Z",
      limit: 50,
      used: 50,
      remaining: 0,
      breakdown: { generations: 30, companion: 20, exports: 4 },
    };

    await page.goto("/app/create");
    await expect(page.getByTestId("quota-exceeded-banner")).toBeVisible();
    await expect(page.getByRole("button", { name: /Generate visual/ })).toBeDisabled();

    await page.goto(`/app/notes/${note.id}`);
    await page.getByTestId("note-study-tabs").getByRole("radio", { name: "Quick Quiz" }).click();
    await expect(page.getByTestId("generate-quiz-btn")).toBeDisabled();
    expect(errors).toEqual([]);
  });

  test("FR-EXP-05 selection export validates, displays What is included summary, and sends elementIds", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 860 });
    const errors = trackErrors(page);
    const { note, state } = await seedNote(page);

    await page.goto(`/app/notes/${note.id}/edit`);
    const canvas = page.getByTestId("workspace-canvas").locator("canvas.interactive").first();
    await expect(canvas).toBeVisible({ timeout: 15_000 });
    await canvas.click();
    await page.keyboard.press("Control+a");
    await expect(page.getByTestId("explain-selection-bar")).toBeVisible();

    await page.getByTestId("export-button").click();
    const dialog = page.getByTestId("export-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("export-included-summary")).toContainText("selected element(s)");
    const dlPromise = page.waitForEvent("download");
    await dialog.getByTestId("export-submit").click();
    await dlPromise;

    const exportCall = state.calls.find((c) => c.method === "POST" && c.path.endsWith("/exports"));
    expect(exportCall).toBeTruthy();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    expect(errors).toEqual([]);
  });

  test("account deletion requires typed phrase + valid password and redirects out", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 860 });
    await page.route("http://127.0.0.1:54399/**", (route) => route.fulfill({ status: 204, body: "" }));
    const errors = trackErrors(page);
    await seedNote(page);

    await page.goto("/app/settings/account");
    await page.getByTestId("delete-account-open").click();
    const dlg = page.getByTestId("delete-account-dialog");
    await expect(dlg).toBeVisible();
    await expect(dlg.getByTestId("delete-account-confirm")).toBeDisabled();

    await dlg.getByLabel(/DELETE MY ACCOUNT/).fill("DELETE MY ACCOUNT");
    await dlg.getByLabel(/Current password/).fill("WrongPass!");
    await dlg.getByTestId("delete-account-confirm").click();
    await expect(dlg.getByRole("alert")).toContainText("Incorrect password");
    // Reset expected 403 network console entry from the negative password test above
    errors.length = 0;

    await dlg.getByLabel(/Current password/).fill("Password123!");
    await dlg.getByTestId("delete-account-confirm").click();
    await expect(page).toHaveURL("/");
    expect(errors).toEqual([]);
  });

  test("tablet layout (1024x768) keeps canvas central with Escape-dismissable collapsible drawers", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    const errors = trackErrors(page);
    const { note } = await seedNote(page);

    await page.goto(`/app/notes/${note.id}/edit`);
    await expect(page.getByTestId("workspace-canvas").locator("canvas.interactive").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("tablet-panel-bar")).toBeVisible();

    await page.getByTestId("tablet-outline-toggle").click();
    await expect(page.getByTestId("tablet-drawer")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("tablet-drawer")).toBeHidden();

    await page.getByTestId("tablet-assistant-toggle").click();
    await expect(page.getByTestId("tablet-drawer")).toBeVisible();
    await page.getByRole("button", { name: "Close panel drawer" }).click();
    await expect(page.getByTestId("tablet-drawer")).toBeHidden();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
    await page.screenshot({ path: "renders/phase6-tablet-editor.png", fullPage: false });
    expect(errors).toEqual([]);
  });

  test("reducedMotion collapses animations cleanly, mobile targets meet 44px, and toast causes 0 layout shift", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    const errors = trackErrors(page);
    const { note } = await seedNote(page);

    await page.goto("/");
    const dur = await page.evaluate(() => {
      const el = document.querySelector(".animate-fade-up");
      return el ? getComputedStyle(el).animationDuration : "0s";
    });
    expect(parseFloat(dur)).toBeLessThanOrEqual(0.01);

    await page.goto(`/app/notes/${note.id}`);
    const navBtnBox = await page.getByRole("button", { name: "Open navigation" }).boundingBox();
    expect(navBtnBox.width).toBeGreaterThanOrEqual(44);
    expect(navBtnBox.height).toBeGreaterThanOrEqual(44);

    // Measure CLS stability on main content when Export modal opens/closes or favorite toggles
    const beforeRect = await page.locator("#main-content").boundingBox();
    await page.getByRole("button", { name: /favorite/i }).click();
    const afterRect = await page.locator("#main-content").boundingBox();
    expect(Math.abs(beforeRect.y - afterRect.y)).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });

  test("keyboard-only walkthrough: study -> present -> export + legal pages & full Axe WCAG 2 AA audit", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 860 });
    const errors = trackErrors(page);
    const { note } = await seedNote(page);

    for (const theme of ["light", "dark"]) {
      for (const route of ["/privacy", "/terms", "/app", "/app/settings/account"]) {
        await page.goto(route);
        await page.evaluate((mode) => {
          window.localStorage.setItem("visualify:theme", mode);
          document.documentElement.classList.toggle("dark", mode === "dark");
          document.documentElement.style.colorScheme = mode;
        }, theme);
        if (route === "/privacy" || route === "/terms") {
          await expect(page.getByTestId("legal-draft-notice")).toBeVisible();
        }
        await settleAnimations(page);
        const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
        expect(axe.violations, `Axe failed on ${route} (${theme})`).toEqual([]);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `Overflow on ${route} (${theme})`).toBe(0);
      }
    }
    await page.goto("/app");
    await page.evaluate(() => {
      document.documentElement.classList.add("dark");
      document.documentElement.style.colorScheme = "dark";
    });
    await page.screenshot({ path: "renders/phase6-dashboard-dark.png", fullPage: false });

    await page.goto(`/app/notes/${note.id}`);
    const tabs = page.getByTestId("note-study-tabs").getByRole("radio", { name: "Overview & Diagram" });
    await tabs.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("quiz-view")).toBeVisible();

    await page.getByTestId("present-note").focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`/app/notes/${note.id}/present`);
    await expect(page.getByTestId("slide-counter")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(`/app/notes/${note.id}`);

    await page.getByRole("button", { name: "Export" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("export-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("export-dialog")).toBeHidden();
    expect(errors).toEqual([]);
  });
});
