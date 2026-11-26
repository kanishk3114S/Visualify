/**
 * Captures deterministic, PII-free light/dark + desktop/mobile screenshots of Visualify
 * for README.md and docs/assets/ using the existing Vite frontend and contract mocks.
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { makeProfile, mockApi, signInWithFakeSession } from "../tests/e2e/support/mockBackend.js";
import { PLAN, SCENE } from "../tests/e2e/support/generationMocks.js";
import { renderBrandMarkSvg } from "../frontend/src/brand/markGeometry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ASSETS_DIR = path.join(ROOT, "docs", "assets");
const SCREENSHOT_PORT = 5174;
const ORIGIN = `http://127.0.0.1:${SCREENSHOT_PORT}`;

const WINDOWS_CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

async function waitForServer(url, timeoutMs = 45_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // keep polling until ready
    }
    await new Promise((r) => setTimeout(r, 350));
  }
  throw new Error(`Timed out waiting for Vite server on ${url}`);
}

function startViteServer() {
  const child = spawn(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["--workspace=@visualify/frontend", "run", "dev", "--", "--host", "127.0.0.1", "--port", String(SCREENSHOT_PORT), "--strictPort"],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        VITE_SUPABASE_URL: "http://127.0.0.1:54399",
        VITE_SUPABASE_PUBLISHABLE_KEY: "e2e-placeholder-publishable-key",
        VITE_API_BASE_URL: "http://127.0.0.1:5999",
      },
      stdio: "ignore",
      shell: process.platform === "win32",
    }
  );
  return child;
}

async function applyThemeAndCapture(page, url, outPath, { theme = "light", waitSelector = "main", timeout = 30_000 } = {}) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript((mode) => {
    window.localStorage.setItem("visualify:theme", mode);
  }, theme);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.evaluate((mode) => {
    window.localStorage.setItem("visualify:theme", mode);
    const root = document.documentElement;
    root.classList.toggle("dark", mode === "dark");
    root.setAttribute("data-theme", mode);
    root.style.colorScheme = mode;
  }, theme);
  await page.locator(waitSelector).first().waitFor({ state: "visible", timeout });
  await page.waitForTimeout(450);
  await page.screenshot({ path: outPath });
}

async function captureBrandStrip(browser) {
  const ctx = await browser.newContext({ viewport: { width: 880, height: 260 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const sizes = [16, 24, 32, 64];
  const makeRow = (bg, labelColor) =>
    `<div style="display:flex;align-items:center;gap:28px;padding:24px 32px;background:${bg};color:${labelColor};font-family:system-ui,sans-serif">
      ${sizes
        .map(
          (s) =>
            `<div style="display:flex;flex-direction:column;align-items:center;gap:8px">
              ${renderBrandMarkSvg({ size: s, darkAware: false, backdropColor: "#0f766e" })}
              <span style="font-size:12px;font-weight:600">${s}px</span>
            </div>`
        )
        .join("")}
    </div>`;

  await page.setContent(`
    <!doctype html>
    <html>
      <body style="margin:0;display:grid;grid-template-columns:1fr 1fr;height:260px">
        ${makeRow("#faf8f5", "#1c1917")}
        ${makeRow("#12100e", "#f5f3f1")}
      </body>
    </html>
  `);
  await page.screenshot({ path: path.join(ASSETS_DIR, "brand-strip.png") });
  await ctx.close();
}

async function main() {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  const server = startViteServer();

  const browser = await chromium.launch({
    headless: true,
    ...(process.platform === "win32" && fs.existsSync(WINDOWS_CHROME) ? { executablePath: WINDOWS_CHROME } : {}),
  });

  try {
    await waitForServer(ORIGIN);

    // 1. Public marketing hero captures (light & dark, desktop 1440 & mobile 390)
    for (const theme of ["light", "dark"]) {
      const desktopCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
      const desktopPage = await desktopCtx.newPage();
      await applyThemeAndCapture(desktopPage, `${ORIGIN}/`, path.join(ASSETS_DIR, `hero-${theme}.png`), {
        theme,
        waitSelector: '[data-testid="landing-showcase"]',
      });
      await desktopCtx.close();

      const mobileCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
      const mobilePage = await mobileCtx.newPage();
      await applyThemeAndCapture(mobilePage, `${ORIGIN}/`, path.join(ASSETS_DIR, `hero-mobile-${theme}.png`), {
        theme,
        waitSelector: "h1",
      });
      await mobileCtx.close();
    }

    // 2. Authenticated workspace, dashboard, create, study, present screenshots
    const setupSignedInContext = async (theme, viewport = { width: 1440, height: 900 }) => {
      const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      page.on("pageerror", (err) => console.error("[pageerror]", err.message));
      await signInWithFakeSession(page);
      const handle = await mockApi(page, {
        profile: makeProfile({
          display_name: "Avery Chen",
          username: "averychen",
          preferences: { theme, defaultExportFormat: "png", learningLevel: "undergraduate" },
        }),
      });
      const seeded = handle.notes.seedNote({
        title: "Databases at a glance",
        subject: "Databases",
        tags: ["sql", "nosql"],
        scene: SCENE,
        plan: PLAN,
      });
      return { ctx, page, noteId: seeded.id };
    };

    for (const theme of ["light", "dark"]) {
      const { ctx, page, noteId } = await setupSignedInContext(theme);
      await applyThemeAndCapture(page, `${ORIGIN}/app`, path.join(ASSETS_DIR, `dashboard-${theme}.png`), {
        theme,
        waitSelector: '[data-testid="library-stats"]',
      });
      await applyThemeAndCapture(page, `${ORIGIN}/app/notes/${noteId}/edit`, path.join(ASSETS_DIR, `workspace-${theme}.png`), {
        theme,
        waitSelector: '[data-testid="workspace-canvas"] canvas',
        timeout: 45_000,
      });
      await applyThemeAndCapture(page, `${ORIGIN}/app/notes/${noteId}?view=overview`, path.join(ASSETS_DIR, `study-${theme}.png`), {
        theme,
        waitSelector: '[data-testid="note-study-tabs"]',
      });
      await ctx.close();
    }

    // Create + Presentation dark capture + Mobile study dark capture
    const { ctx: extraCtx, page: extraPage, noteId: extraNoteId } = await setupSignedInContext("light");
    await applyThemeAndCapture(extraPage, `${ORIGIN}/app/create`, path.join(ASSETS_DIR, "create.png"), {
      theme: "light",
      waitSelector: '[data-testid="input-mode-switch"]',
    });
    await applyThemeAndCapture(extraPage, `${ORIGIN}/app/notes/${extraNoteId}/present`, path.join(ASSETS_DIR, "present-dark.png"), {
      theme: "dark",
      waitSelector: '[data-testid="present-view"]',
    });
    await extraCtx.close();

    // 3. Brand mark optical clarity strip (16/24/32/64px light + dark)
    await captureBrandStrip(browser);

    console.log("[docs:screenshots] Captured light/dark desktop, mobile, workspace, dashboard, study, and brand strip screenshots.");
  } finally {
    await browser.close();
    server.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
