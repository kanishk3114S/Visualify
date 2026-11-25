import { test, expect } from "@playwright/test";
import { mockApi, signInWithFakeSession, trackErrors } from "./support/mockBackend.js";
import { createGenerationMock, PLAN, SCENE } from "./support/generationMocks.js";
import { createNotesMock, routeStorageDownloads } from "./support/notesMocks.js";

async function drawRectangle(page, offset = 0) {
  const canvas = page.getByTestId("workspace-canvas").locator("canvas.interactive").first();
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  const box = await canvas.boundingBox();
  await canvas.click({ position: { x: 40, y: 40 } });
  await page.keyboard.press("r");
  await page.mouse.move(box.x + box.width - 220 - offset, box.y + box.height - 160 - offset);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 120 - offset, box.y + box.height - 90 - offset);
  await page.mouse.up();
}

test.describe("Phase 3: generation -> save -> library -> edit -> versions -> export", () => {
  test("saves a generated visual to the library, autosaves canvas edits, and persists across reload", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 860 });
    const errors = trackErrors(page);
    await signInWithFakeSession(page);
    const generations = createGenerationMock();
    const notes = createNotesMock({ generations });
    await mockApi(page, { generations, notes });

    await page.goto("/app/create");
    await page.getByLabel("What do you want to understand?").fill("Compare SQL and NoSQL databases");
    await page.getByRole("button", { name: "Generate visual" }).click();
    await expect(page.getByTestId("visual-workspace")).toBeVisible({ timeout: 15_000 });

    await page.getByTestId("save-to-library").click();
    const saveDialog = page.getByTestId("save-dialog");
    await expect(saveDialog).toBeVisible();
    await saveDialog.getByLabel(/Title/).fill("SQL vs NoSQL Notes");
    await saveDialog.getByRole("button", { name: "Save" }).click();

    await expect(page).toHaveURL(/\/app\/notes\/[0-9a-f-]{36}\/edit$/);
    await expect(page.getByTestId("toast")).toContainText("Saved to your library.");
    await expect(page.getByTestId("workspace-title")).toHaveText("SQL vs NoSQL Notes");
    await expect(page.getByTestId("save-status")).toHaveAttribute("data-status", "saved");

    await drawRectangle(page);
    await expect.poll(() => notes.calls.some((c) => c.method === "PUT" && c.path.endsWith("/draft")), { timeout: 10_000 }).toBe(true);
    await expect(page.getByTestId("save-status")).toHaveAttribute("data-status", "saved");

    const draftPut = notes.calls.find((c) => c.method === "PUT" && c.path.endsWith("/draft"));
    expect(draftPut.body.sceneJson.elements.length).toBeGreaterThan(SCENE.elements.length);

    await page.reload();
    await expect(page.getByTestId("workspace-title")).toHaveText("SQL vs NoSQL Notes", { timeout: 15_000 });
    await expect(page.getByTestId("save-status")).toHaveAttribute("data-status", "saved");
    expect(errors).toEqual([]);
  });

  test("library supports folders, favorites, search, view toggle, duplicate, archive, and delete", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 860 });
    const errors = trackErrors(page);
    await signInWithFakeSession(page);
    const notes = createNotesMock();
    notes.seedNote({ title: "Binary Search Trees", subject: "Algorithms", tags: ["trees", "search"], scene: SCENE, plan: PLAN });
    notes.seedNote({ title: "HTTP Caching", subject: "Networking", tags: ["http", "cache"], scene: SCENE, plan: PLAN });
    await mockApi(page, { notes });

    await page.goto("/app/notes");
    await expect(page.getByTestId("note-card")).toHaveCount(2);

    await page.getByRole("radio", { name: "List view" }).click();
    await expect(page.getByTestId("note-table")).toBeVisible();
    await expect(page.getByTestId("note-row")).toHaveCount(2);
    await page.getByRole("radio", { name: "Grid view" }).click();
    await expect(page.getByTestId("note-grid")).toBeVisible();

    await page.getByTestId("folder-nav").getByRole("button", { name: "New folder" }).click();
    const folderDialog = page.getByTestId("folder-dialog");
    await expect(folderDialog).toBeVisible();
    await folderDialog.getByLabel(/Folder name/).fill("Computer Science");
    await folderDialog.getByRole("button", { name: "Create" }).click();
    await expect(page.getByTestId("folder-nav").getByRole("link", { name: /Computer Science/ })).toBeVisible();

    await page.getByRole("button", { name: "Actions for Binary Search Trees" }).click();
    await page.getByRole("menuitem", { name: "Move to folder" }).click();
    const moveDialog = page.getByRole("dialog", { name: "Move note" });
    await moveDialog.getByLabel("Folder").selectOption({ label: "Computer Science" });
    await moveDialog.getByRole("button", { name: "Move" }).click();
    await expect(page.getByTestId("toast").filter({ hasText: "Moved to Computer Science." })).toBeVisible();

    await page.getByTestId("folder-nav").getByRole("link", { name: /Computer Science/ }).click();
    await expect(page.getByTestId("note-card")).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Binary Search Trees" })).toBeVisible();

    await page.getByTestId("folder-nav").getByRole("link", { name: "All notes" }).click();
    await expect(page.getByTestId("note-card")).toHaveCount(2);

    await page.getByRole("button", { name: "Add Binary Search Trees to favorites" }).click();
    await page.getByRole("button", { name: "Favorites", exact: true }).click();
    await expect(page.getByTestId("note-card")).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Binary Search Trees" })).toBeVisible();
    await page.getByRole("button", { name: "Favorites", exact: true }).click();
    await expect(page.getByTestId("note-card")).toHaveCount(2);

    await page.getByTestId("library-search").fill("http");
    await expect(page.getByTestId("note-card")).toHaveCount(1);
    await expect(page.getByRole("link", { name: "HTTP Caching" })).toBeVisible();
    await page.getByTestId("library-search").fill("");
    await expect(page.getByTestId("note-card")).toHaveCount(2);

    await page.getByRole("button", { name: "Actions for HTTP Caching" }).click();
    await page.getByRole("menuitem", { name: "Duplicate" }).click();
    await expect(page.getByTestId("note-card")).toHaveCount(3);
    const copyTitle = "Copy of HTTP Caching";
    await expect(page.getByRole("link", { name: copyTitle })).toBeVisible();

    await page.getByRole("button", { name: `Actions for ${copyTitle}` }).click();
    await page.getByRole("menuitem", { name: "Archive" }).click();
    await expect(page.getByTestId("note-card")).toHaveCount(2);

    await page.getByRole("button", { name: "Archived" }).click();
    await expect(page.getByTestId("note-card")).toHaveCount(1);
    await page.getByRole("button", { name: `Actions for ${copyTitle}` }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete note" }).click();
    await expect(page.getByTestId("library-empty-filtered")).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("snapshots, previews and restores versions non-destructively, and exports PNG, SVG and Excalidraw", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 860 });
    const errors = trackErrors(page);
    await signInWithFakeSession(page);
    const notes = createNotesMock();
    const note = notes.seedNote({ title: "Distributed Consensus", subject: "Systems", tags: ["raft"], scene: SCENE, plan: PLAN });
    await mockApi(page, { notes });
    await routeStorageDownloads(page);

    await page.goto(`/app/notes/${note.id}/edit`);
    await expect(page.getByTestId("workspace-title")).toHaveText("Distributed Consensus", { timeout: 15_000 });

    await drawRectangle(page);
    await expect.poll(() => notes.calls.some((c) => c.method === "PUT" && c.path.endsWith("/draft")), { timeout: 10_000 }).toBe(true);
    await expect(page.getByTestId("save-status")).toHaveAttribute("data-status", "saved");

    await page.getByTestId("snapshot-button").click();
    await page.getByLabel("Description (optional)").fill("Added Raft leader box");
    await page.getByRole("button", { name: "Save snapshot" }).click();
    await expect(page.getByTestId("toast").filter({ hasText: "Saved as version 2." })).toBeVisible();

    await page.getByTestId("history-button").click();
    const history = page.getByTestId("version-history");
    await expect(history).toBeVisible();
    await expect(history.getByTestId("version-item")).toHaveCount(2);

    await history.getByRole("button", { name: "Preview version 1" }).click();
    const preview = page.getByTestId("version-preview");
    await expect(preview).toBeVisible();
    await expect(preview.getByRole("heading", { name: "Version 1" })).toBeVisible();
    await preview.getByRole("button", { name: "Restore this version" }).click();
    await page.getByRole("button", { name: "Restore", exact: true }).click();
    await expect(page.getByTestId("toast").filter({ hasText: "Restored version 1 as version 3." })).toBeVisible();

    await page.getByTestId("history-button").click();
    await expect(page.getByTestId("version-history").getByTestId("version-item")).toHaveCount(3);
    await page.getByRole("button", { name: "Close version history" }).click();

    await page.getByTestId("export-button").click();
    const exp = page.getByTestId("export-dialog");
    await expect(exp).toBeVisible();

    await exp.getByRole("radio", { name: /PNG image/ }).check();
    await exp.getByRole("radio", { name: /^Dark/ }).check();
    await exp.getByRole("checkbox", { name: "Transparent background" }).check();
    const [pngDownload] = await Promise.all([page.waitForEvent("download"), exp.getByTestId("export-submit").click()]);
    expect(pngDownload.suggestedFilename()).toBe("distributed-consensus.png");
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(false);

    await exp.getByRole("radio", { name: /SVG vector/ }).check();
    await exp.getByRole("radio", { name: /^Light/ }).check();
    await exp.getByRole("checkbox", { name: "Transparent background" }).uncheck();
    const [svgDownload] = await Promise.all([page.waitForEvent("download"), exp.getByTestId("export-submit").click()]);
    expect(svgDownload.suggestedFilename()).toBe("distributed-consensus.svg");

    await exp.getByRole("radio", { name: /Excalidraw file/ }).check();
    await expect(exp.getByRole("radio", { name: /^Dark/ })).toBeDisabled();
    await expect(exp.getByRole("checkbox", { name: "Transparent background" })).toBeDisabled();
    const [rawDownload] = await Promise.all([page.waitForEvent("download"), exp.getByTestId("export-submit").click()]);
    expect(rawDownload.suggestedFilename()).toBe("distributed-consensus.excalidraw");

    const exportCalls = notes.calls.filter((c) => c.method === "POST" && c.path.endsWith("/exports"));
    expect(exportCalls.map((c) => [c.body.format, c.body.theme, c.body.transparent])).toEqual([
      ["png", "dark", true],
      ["svg", "light", false],
      ["excalidraw", "light", false],
    ]);
    expect(errors).toEqual([]);
  });
});
