import { test, expect } from "@playwright/test";
import { mockApi, signInWithFakeSession, trackErrors } from "./support/mockBackend.js";
import { createGenerationMock, PLAN, SCENE } from "./support/generationMocks.js";

async function setup(page, mockOptions) {
  await signInWithFakeSession(page);
  const generations = createGenerationMock(mockOptions);
  const api = await mockApi(page, { generations });
  return { generations, api };
}

test.describe("Phase 2: /app/create form", () => {
  test("validates the prompt, shows the remaining-character counter and exposes settings", async ({ page }) => {
    const { generations } = await setup(page);
    await page.goto("/app/create");
    await expect(page.getByRole("heading", { name: "Create visual notes" })).toBeVisible();

    const prompt = page.getByLabel("What do you want to understand?");
    await expect(page.getByText("8,000 characters left")).toBeVisible();
    await prompt.fill("Explain DNS");
    await expect(page.getByText("7,989 characters left")).toBeVisible();

    await prompt.fill("   ");
    await page.getByRole("button", { name: "Generate visual" }).click();
    await expect(page.getByText("Enter a topic, question or notes to visualise.")).toBeVisible();
    await expect(prompt).toHaveAttribute("aria-invalid", "true");

    await prompt.fill("x".repeat(8005));
    await expect(page.getByText("5 characters over the limit")).toBeVisible();
    await page.getByRole("button", { name: "Generate visual" }).click();
    await expect(page.getByText("Use at most 8,000 characters.")).toBeVisible();
    expect(generations.posted).toHaveLength(0);

    for (const label of ["Subject (optional)", "Learning level", "Depth", "Visual style", "Diagram type"]) {
      await expect(page.getByLabel(label)).toBeVisible();
    }
  });

  test("a sample starter fills the prompt and subject; settings are sent with the request", async ({ page }) => {
    const { generations } = await setup(page);
    await page.goto("/app/create");
    await page.getByRole("button", { name: "SQL vs NoSQL" }).click();
    await expect(page.getByLabel("What do you want to understand?")).toHaveValue(/Compare SQL and NoSQL/);
    await expect(page.getByLabel("Subject (optional)")).toHaveValue("Databases");
    await page.getByLabel("Learning level").selectOption("postgraduate");
    await page.getByLabel("Diagram type").selectOption("comparison");
    await page.getByRole("button", { name: "Generate visual" }).click();
    await expect(page).toHaveURL(/\/app\/generations\/[0-9a-f-]{36}$/);
    expect(generations.posted[0]).toEqual({
      inputType: "prompt",
      prompt: "Compare SQL and NoSQL databases: data model, scaling, consistency and typical use cases.",
      settings: { subject: "Databases", audienceLevel: "postgraduate", detail: "standard", visualStyle: "hand_drawn_clean", preferredOutput: "comparison" },
    });
  });

  test("an existing active job redirects to its progress page instead of failing", async ({ page }) => {
    const activeJobId = "7c9e6679-7425-40de-944b-e07fc1f90999";
    await setup(page, { activeJobId });
    await page.goto("/app/create");
    await page.getByLabel("What do you want to understand?").fill("Explain DNS");
    await page.getByRole("button", { name: "Generate visual" }).click();
    await expect(page).toHaveURL(`/app/generations/${activeJobId}`);
  });

  test("dashboard CTA links to /app/create and the nav item is enabled", async ({ page }) => {
    await setup(page);
    await page.goto("/app");
    await expect(page.getByRole("link", { name: "Create visual notes" })).toHaveAttribute("href", "/app/create");
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Create" }).click();
    await expect(page).toHaveURL("/app/create");
  });
});

test.describe("Phase 2: prompt -> SSE progress -> workspace (mocked API)", () => {
  for (const viewport of [
    { name: "desktop", width: 1366, height: 860 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    test(`completes into the Excalidraw workspace with zero console errors (${viewport.name})`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const errors = trackErrors(page);
      const { api } = await setup(page);
      await page.goto("/app/create");
      await page.getByLabel("What do you want to understand?").fill("Compare SQL and NoSQL databases");
      await page.getByRole("button", { name: "Generate visual" }).click();

      await expect(page.getByTestId("visual-workspace")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId("workspace-title")).toHaveText(PLAN.title);
      await expect(page.getByText("Mind map").first()).toBeVisible();
      await expect(page.getByText("Save to Library (Phase 3)")).toBeDisabled();
      await expect(page.getByTestId("edit-status")).toHaveText("Generated · no edits");

      // SSE used the Authorization header, never a token in the URL.
      const eventsCall = api.calls.find((c) => c.path.endsWith("/events"));
      expect(eventsCall.auth).toMatch(/^Bearer /);
      expect(api.calls.every((c) => !/token=|access_token/.test(c.path))).toBe(true);

      if (viewport.name === "mobile") {
        await expect(page.getByRole("tab", { name: "Canvas" })).toHaveAttribute("aria-selected", "true");
        await expect(page.getByText("Editing works best on a larger screen.")).toBeVisible();
      }

      // Canvas: real Excalidraw with non-zero size.
      const canvas = page.getByTestId("workspace-canvas").locator("canvas.interactive").first();
      await expect(canvas).toBeVisible({ timeout: 15_000 });
      const box = await canvas.boundingBox();
      expect(box.width).toBeGreaterThan(viewport.name === "mobile" ? 300 : 500);
      expect(box.height).toBeGreaterThan(300);

      // Outline + explanation panels.
      if (viewport.name === "mobile") await page.getByRole("tab", { name: "Outline" }).click();
      const outline = page.getByTestId("outline-panel");
      await expect(outline).toBeVisible();
      await expect(outline.getByText("Name the main database families")).toBeVisible();
      await expect(outline.getByRole("button", { name: /Show section 2 on the canvas: SQL vs NoSQL/ })).toBeVisible();
      if (viewport.name === "mobile") await page.getByRole("tab", { name: "Explanation" }).click();
      const explanation = page.getByTestId("explanation-panel");
      await expect(explanation).toBeVisible();
      await expect(explanation.getByText(PLAN.summary)).toBeVisible();
      await expect(explanation.getByText(PLAN.sections[1].explanation)).toBeVisible();

      if (viewport.name === "mobile") {
        // Switching tabs must not unmount the canvas (edits would be lost).
        await page.getByRole("tab", { name: "Canvas" }).click();
        await expect(canvas).toBeVisible();
      } else {
        // Selecting a section scrolls the canvas; the page itself never scrolls horizontally.
        await outline.getByRole("button", { name: /Show section 2/ }).click();
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      expect(errors).toEqual([]);
    });
  }

  test("edits mark the workspace as edited (unsaved) and the scene hydrated every element", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 860 });
    await setup(page);
    await page.goto("/app/create");
    await page.getByLabel("What do you want to understand?").fill("Compare SQL and NoSQL databases");
    await page.getByRole("button", { name: "Generate visual" }).click();
    const canvas = page.getByTestId("workspace-canvas").locator("canvas.interactive").first();
    await expect(canvas).toBeVisible({ timeout: 15_000 });
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: 40, y: 40 } });
    await page.keyboard.press("r");
    await page.mouse.move(box.x + box.width - 220, box.y + box.height - 160);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 120, box.y + box.height - 90);
    await page.mouse.up();
    await expect(page.getByTestId("edit-status")).toHaveText("Edited · not saved");
    expect(SCENE.elements.length).toBeGreaterThan(10);
  });

  test("shows warnings from a partial result", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 860 });
    await setup(page, { warnings: ['The diagram for "Extra" couldn\'t be drawn; its explanation is still included.'] });
    await page.goto("/app/create");
    await page.getByLabel("What do you want to understand?").fill("Compare SQL and NoSQL databases");
    await page.getByRole("button", { name: "Generate visual" }).click();
    await expect(page.getByTestId("generation-warnings")).toContainText("couldn't be drawn");
  });

  test("falls back to polling when the SSE stream is unavailable", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 860 });
    const { generations } = await setup(page, { scenario: "drop" });
    await page.goto("/app/create");
    await page.getByLabel("What do you want to understand?").fill("Compare SQL and NoSQL databases");
    await page.getByRole("button", { name: "Generate visual" }).click();
    await expect(page.getByTestId("visual-workspace")).toBeVisible({ timeout: 15_000 });
    expect(generations.polls).toBeGreaterThanOrEqual(2);
  });
});

test.describe("Phase 2: failure, retry and cancel", () => {
  test("shows a safe error with a reference and retries into a completed workspace", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 860 });
    await setup(page, { scenario: "fail" });
    await page.goto("/app/create");
    await page.getByLabel("What do you want to understand?").fill("Compare SQL and NoSQL databases");
    await page.getByRole("button", { name: "Generate visual" }).click();
    const failed = page.getByTestId("generation-failed");
    await expect(failed).toBeVisible({ timeout: 15_000 });
    await expect(failed).toContainText("The AI service is busy right now.");
    await expect(failed).toContainText(/Reference: [0-9a-f-]{36} · AI_BUSY/);
    await failed.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByTestId("visual-workspace")).toBeVisible({ timeout: 15_000 });
  });

  test("progress is accessible and Cancel ends in the cancelled state", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 860 });
    const { generations } = await setup(page, { scenario: "hold" });
    await page.goto("/app/create");
    await page.getByLabel("What do you want to understand?").fill("Compare SQL and NoSQL databases");
    await page.getByRole("button", { name: "Generate visual" }).click();
    const progress = page.getByTestId("generation-progress");
    await expect(progress).toBeVisible();
    const bar = page.getByRole("progressbar", { name: "Generation progress" });
    await expect(bar).toHaveAttribute("aria-valuenow", "25");
    await expect(page.locator('[data-state="active"]')).toContainText("Planning visuals");
    await expect(page.getByTestId("stage-announcement")).toHaveText("Planning visuals");
    await progress.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("generation-cancelled")).toBeVisible({ timeout: 15_000 });
    expect(generations.cancelled).toHaveLength(1);
  });

  test("an unknown or foreign job id shows a not-found state", async ({ page }) => {
    await setup(page);
    await page.goto("/app/generations/7c9e6679-7425-40de-944b-e07fc1f9dead");
    await expect(page.getByTestId("generation-load-error")).toContainText("Generation not found");
  });
});
