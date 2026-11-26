import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { settleAnimations } from "./support/a11y.js";
import { makeProfile, mockApi, signInWithFakeSession, trackErrors } from "./support/mockBackend.js";
import { createGenerationMock, PLAN, SCENE } from "./support/generationMocks.js";
import { createNotesMock } from "./support/notesMocks.js";

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

test.describe("Phase 4 & UI Polish: interactive landing, PDF/image flows, workspace tools, axe & screenshots", () => {
  test("landing showcase switches diagram tabs, inspects nodes, and toggles preview theme", async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("/");
    const showcase = page.getByTestId("landing-showcase");
    await expect(showcase).toBeVisible();

    await showcase.getByRole("radio", { name: "Flowchart" }).click();
    await expect(showcase.getByTestId("showcase-callout")).toContainText("React SPA:");
    await showcase.getByRole("button", { name: /Zod Valid\?/ }).click();
    await expect(showcase.getByTestId("showcase-callout")).toContainText("Decision branch");

    await showcase.getByRole("radio", { name: "Mind map" }).click();
    await showcase.getByRole("button", { name: /Virtual Memory/ }).click();
    await expect(showcase.getByTestId("showcase-callout")).toContainText("Page tables");

    const themeBtn = showcase.getByRole("button", { name: /Switch preview canvas to dark mode/i });
    await themeBtn.click();
    await expect(showcase.getByRole("button", { name: /Switch preview canvas to light mode/i })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("PDF upload -> page range selection -> generation -> workspace provenance -> save -> study checklist", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 860 });
    const errors = trackErrors(page);
    await signInWithFakeSession(page);
    const generations = createGenerationMock();
    const notes = createNotesMock({ generations });
    await mockApi(page, { generations, notes });

    await page.goto("/app/create");
    await page.getByTestId("input-mode-switch").getByRole("radio", { name: "PDF Document" }).click();

    await page.getByTestId("source-file-input").setInputFiles({
      name: "lecture-notes.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"),
    });

    const card = page.getByTestId("uploaded-source-card");
    await expect(card).toBeVisible();
    await expect(card).toContainText("lecture-notes.pdf");
    await expect(card).toContainText("18 pages");

    await card.getByRole("radio", { name: "Page range" }).click();
    await card.getByLabel("From page").fill("2");
    await card.getByLabel("To page").fill("6");
    await page.getByLabel("What should Visualify focus on? (optional)").fill("Focus on database indexing");

    await page.getByRole("button", { name: "Generate visual" }).click();
    await expect(page.getByTestId("visual-workspace")).toBeVisible({ timeout: 15_000 });

    expect(generations.posted[0]).toMatchObject({
      inputType: "pdf",
      sourceFileId: "8a2f6679-7425-40de-944b-e07fc1f90001",
      pageRange: { mode: "range", startPage: 2, endPage: 6 },
      prompt: "Focus on database indexing",
    });

    // Source badge & page citations visible in workspace
    await expect(page.getByTestId("workspace-source-badge")).toContainText("lecture-notes.pdf");
    await expect(page.getByTestId("workspace-source-badge")).toContainText("Pages 2–6");
    await expect(page.getByTestId("outline-panel")).toContainText("Page 2");

    // Quick canvas toolbar controls (Fit, Zoom to section, Color guide)
    const toolbar = page.getByTestId("canvas-toolbar");
    await toolbar.getByRole("button", { name: "Color guide" }).click();
    await expect(page.getByTestId("color-legend")).toBeVisible();
    await toolbar.getByRole("button", { name: "Fit to screen" }).click();
    await toolbar.getByRole("button", { name: "Zoom to section" }).click();

    // Save to library & verify PDF badge + interactive study checklist on NoteReadPage
    await page.getByTestId("save-to-library").click();
    const saveDialog = page.getByTestId("save-dialog");
    await saveDialog.getByLabel(/Title/).fill("Indexing PDF Notes");
    await saveDialog.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL(/\/app\/notes\/[0-9a-f-]{36}\/edit$/);

    const noteId = page.url().match(/\/app\/notes\/([0-9a-f-]{36})\/edit$/)?.[1];
    await page.goto(`/app/notes/${noteId}`);
    await expect(page.getByTestId("note-source-card")).toContainText("lecture-notes.pdf");

    const checklist = page.getByTestId("study-checklist");
    await expect(checklist).toContainText("0 / 5 reviewed");
    await checklist.getByRole("button", { name: /Study checklist/ }).click();
    await checklist.getByRole("checkbox", { name: "Relational" }).click();
    await expect(checklist).toContainText("1 / 5 reviewed");

    await page.goto("/app/notes");
    await expect(page.getByTestId("note-card")).toContainText("PDF");
    expect(errors).toEqual([]);
  });

  test("Image upload shows sanitized preview and submits image generation", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 860 });
    const errors = trackErrors(page);
    await signInWithFakeSession(page);
    const generations = createGenerationMock();
    await mockApi(page, { generations });

    await page.goto("/app/create");
    await page.getByTestId("input-mode-switch").getByRole("radio", { name: "Image / Notes" }).click();
    await page.getByTestId("source-file-input").setInputFiles({
      name: "handwritten.png",
      mimeType: "image/png",
      buffer: PNG_1PX,
    });

    const card = page.getByTestId("uploaded-source-card");
    await expect(card).toContainText("handwritten-notes.png");
    await expect(card.locator("img")).toBeVisible();
    await page.getByRole("button", { name: "Generate visual" }).click();
    await expect(page.getByTestId("visual-workspace")).toBeVisible({ timeout: 15_000 });
    expect(generations.posted[0]).toMatchObject({ inputType: "image", sourceFileId: "8a2f6679-7425-40de-944b-e07fc1f90001" });
    expect(errors).toEqual([]);
  });

  for (const viewport of [
    { name: "desktop", width: 1366, height: 860 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    for (const theme of ["light", "dark"]) {
      test(`axe WCAG 2 AA + zero overflow + visual screenshots (${viewport.name}, ${theme})`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.addInitScript((mode) => window.localStorage.setItem("visualify:theme", mode), theme);
        const errors = trackErrors(page);

        // Public landing page
        await page.goto("/");
        await expect(page.getByTestId("landing-showcase")).toBeVisible();
        await settleAnimations(page);
        const landingAxe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
        expect(landingAxe.violations).toEqual([]);
        const landingOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(landingOverflow).toBeLessThanOrEqual(0);
        await page.screenshot({ path: `renders/phase4-landing-${viewport.name}-${theme}.png`, fullPage: false, animations: "disabled" });

        // Signed-in Create (PDF mode) & NoteReadPage
        await signInWithFakeSession(page);
        const generations = createGenerationMock();
        const notes = createNotesMock({ generations });
        const note = notes.seedNote({
          title: "Distributed Consensus Notes",
          subject: "Systems",
          tags: ["raft"],
          scene: SCENE,
          plan: PLAN,
          sourceType: "pdf",
          sourceFile: { id: "sf-1", originalName: "raft-paper.pdf", mimeType: "application/pdf", pageCount: 16 },
        });
        await mockApi(page, {
          profile: makeProfile({ preferences: { theme, defaultExportFormat: "png", learningLevel: "undergraduate" } }),
          generations,
          notes,
        });

        await page.goto("/app/create");
        await page.getByTestId("input-mode-switch").getByRole("radio", { name: "PDF Document" }).click();
        await expect(page.getByTestId("source-dropzone")).toBeVisible();
        await settleAnimations(page);
        const createAxe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
        expect(createAxe.violations).toEqual([]);
        const createOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(createOverflow).toBeLessThanOrEqual(0);
        await page.screenshot({ path: `renders/phase4-create-${viewport.name}-${theme}.png`, fullPage: false, animations: "disabled" });

        await page.goto(`/app/notes/${note.id}`);
        await expect(page.getByTestId("study-checklist")).toBeVisible();
        await settleAnimations(page);
        const readAxe = await new AxeBuilder({ page }).exclude(".excalidraw").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
        expect(readAxe.violations).toEqual([]);
        const readOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(readOverflow).toBeLessThanOrEqual(0);
        if (viewport.name === "desktop") {
          await page.screenshot({ path: `renders/phase4-read-${theme}.png`, fullPage: false, animations: "disabled" });
        }

        expect(errors).toEqual([]);
      });
    }
  }
});
