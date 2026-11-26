import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { settleAnimations } from "./support/a11y.js";
import { makeProfile, mockApi, signInWithFakeSession, trackErrors } from "./support/mockBackend.js";
import { PLAN, SCENE } from "./support/generationMocks.js";
import { createNotesMock } from "./support/notesMocks.js";

function seedLibrary() {
  const notes = createNotesMock();
  const note = notes.seedNote({
    title: "TCP Three-Way Handshake",
    subject: "Computer Networks",
    tags: ["tcp", "networking"],
    scene: SCENE,
    plan: PLAN,
  });
  notes.seedNote({
    title: "B-Trees in Databases",
    subject: "Databases",
    tags: ["storage", "indexing"],
    scene: SCENE,
    plan: PLAN,
  });
  return { notes, note };
}

test.describe("Phase 3: Light / Dark / System theme", () => {
  test("signed-out users can toggle Light, Dark and System modes with reload persistence", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    const errors = trackErrors(page);
    await page.goto("/");

    const html = page.locator("html");
    await expect(html).not.toHaveClass(/\bdark\b/);

    await page.getByTestId("theme-toggle").click();
    await page.getByRole("menuitemradio", { name: "Dark" }).click();
    await expect(html).toHaveClass(/\bdark\b/);
    await expect(html).toHaveAttribute("data-theme", "dark");

    await page.reload();
    await expect(html).toHaveClass(/\bdark\b/);

    await page.getByTestId("theme-toggle").click();
    await page.getByRole("menuitemradio", { name: "System" }).click();
    await expect(html).not.toHaveClass(/\bdark\b/);

    await page.emulateMedia({ colorScheme: "dark" });
    await expect(html).toHaveClass(/\bdark\b/);

    await page.emulateMedia({ colorScheme: "light" });
    await expect(html).not.toHaveClass(/\bdark\b/);
    expect(errors).toEqual([]);
  });

  test("signed-in toggle syncs profile preferences, survives reload, and preferences page updates it", async ({ page }) => {
    const errors = trackErrors(page);
    await signInWithFakeSession(page);
    const api = await mockApi(page, { profile: makeProfile({ preferences: { theme: "light", defaultExportFormat: "png", learningLevel: "undergraduate" } }) });

    await page.goto("/app");
    const html = page.locator("html");
    await expect(html).not.toHaveClass(/\bdark\b/);

    await page.getByTestId("theme-toggle").click();
    await page.getByRole("menuitemradio", { name: "Dark" }).click();
    await expect(html).toHaveClass(/\bdark\b/);

    await expect.poll(() => api.calls.some((c) => c.method === "PATCH" && c.path === "/api/v1/me" && c.body?.preferences?.theme === "dark")).toBe(true);
    expect(api.profile.preferences.theme).toBe("dark");

    await page.reload();
    await expect(html).toHaveClass(/\bdark\b/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    await page.goto("/app/settings/preferences");
    const themeSelect = page.getByLabel("Theme", { exact: true });
    await expect(themeSelect).toHaveValue("dark");
    await themeSelect.selectOption("light");
    await page.getByRole("button", { name: "Save preferences" }).click();
    await expect(page.getByTestId("toast").filter({ hasText: "Preferences saved." })).toBeVisible();
    await expect(html).not.toHaveClass(/\bdark\b/);
    expect(errors).toEqual([]);
  });
});

test.describe("Phase 3: WCAG AA contrast & axe audit across themes", () => {
  for (const theme of ["light", "dark"]) {
    test(`public & auth routes pass axe WCAG 2 AA (${theme})`, async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 860 });
      await page.addInitScript((mode) => window.localStorage.setItem("visualify:theme", mode), theme);
      const errors = trackErrors(page);

      for (const path of ["/", "/features", "/login", "/signup"]) {
        await page.goto(path);
        await expect(page.locator("h1").first()).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await settleAnimations(page);
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
        expect(results.violations, `Axe violations on ${path} (${theme}): ${JSON.stringify(results.violations, null, 2)}`).toEqual([]);
      }
      expect(errors).toEqual([]);
    });

    test(`authenticated routes pass axe WCAG 2 AA (${theme})`, async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 860 });
      await signInWithFakeSession(page);
      const { notes, note } = seedLibrary();
      await mockApi(page, {
        profile: makeProfile({ preferences: { theme, defaultExportFormat: "png", learningLevel: "undergraduate" } }),
        notes,
      });
      const errors = trackErrors(page);

      const routes = [
        { path: "/app", ready: () => expect(page.getByRole("heading", { level: 1 })).toBeVisible() },
        { path: "/app/create", ready: () => expect(page.getByRole("heading", { name: "Create visual notes" })).toBeVisible() },
        { path: "/app/notes", ready: () => expect(page.getByTestId("note-card")).toHaveCount(2) },
        { path: `/app/notes/${note.id}`, ready: () => expect(page.getByTestId("note-title")).toBeVisible() },
        { path: `/app/notes/${note.id}/edit`, ready: () => expect(page.getByTestId("workspace-canvas").locator("canvas.interactive").first()).toBeVisible({ timeout: 15_000 }) },
        { path: "/app/profile", ready: () => expect(page.getByLabel("Username")).toBeVisible() },
        { path: "/app/settings/preferences", ready: () => expect(page.getByLabel("Theme", { exact: true })).toBeVisible() },
      ];

      for (const { path, ready } of routes) {
        await page.goto(path);
        await ready();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        // Excalidraw internals manage their own canvas & toolbars; audit all Visualify chrome & pages.
        await settleAnimations(page);
        const results = await new AxeBuilder({ page }).exclude(".excalidraw").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
        expect(results.violations, `Axe violations on ${path} (${theme}): ${JSON.stringify(results.violations, null, 2)}`).toEqual([]);
      }
      expect(errors).toEqual([]);
    });
  }
});

test.describe("Phase 3: desktop & mobile visual screenshots in Light and Dark", () => {
  for (const viewport of [
    { name: "desktop", width: 1366, height: 860 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    for (const theme of ["light", "dark"]) {
      test(`renders library without horizontal overflow and captures ${viewport.name} ${theme} screenshot`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await signInWithFakeSession(page);
        const { notes, note } = seedLibrary();
        await mockApi(page, {
          profile: makeProfile({ preferences: { theme, defaultExportFormat: "png", learningLevel: "undergraduate" } }),
          notes,
        });
        const errors = trackErrors(page);

        await page.goto("/app/notes");
        await expect(page.getByTestId("note-card")).toHaveCount(2);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));

        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
        await page.screenshot({ path: `renders/theme-${viewport.name}-${theme}.png`, fullPage: false, animations: "disabled" });

        if (viewport.name === "desktop" && theme === "dark") {
          await page.goto(`/app/notes/${note.id}/edit`);
          await expect(page.getByTestId("workspace-canvas").locator("canvas.interactive").first()).toBeVisible({ timeout: 15_000 });
          await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
          const editorOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          expect(editorOverflow).toBeLessThanOrEqual(0);
          await page.screenshot({ path: "renders/theme-editor-dark.png", fullPage: false, animations: "disabled" });
        }

        expect(errors).toEqual([]);
      });
    }
  }
});
