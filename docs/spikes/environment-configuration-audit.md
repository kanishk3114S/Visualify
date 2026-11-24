# Visualify Phase 0: Environment Configuration & Architecture Audit

**Date:** 25 November 2026  
**Scope:** Phase 0 Technical Spike (`PRD.MD` Sections 8, 9, 16.3, 17, 17.1 & `Agents.MD` Section 21)

---

## 1. Repository & Codebase Inspection Summary

All `process.env` and `import.meta.env` references across the Phase 0 codebase were audited directly:
- **`frontend/src/`:** **0** `import.meta.env` references (`VITE_*` variables are not consumed in Phase 0).
- **`backend/src/`:** No Express API server exists in Phase 0.
- **`backend/worker/src/`:** Reads exactly **4** environment variables:
  1. `GEMINI_API_KEY` (`backend/worker/src/config/env.js`)
  2. `GEMINI_MODEL` (`backend/worker/src/config/env.js`, `backend/worker/src/services/geminiPlanner.js`)
  3. `EXCALIDRAW_BROWSER_PATH` (`backend/worker/src/config/env.js`, `backend/worker/src/renderer/cliRenderer.js`)
  4. `CLI_RENDER_TIMEOUT_MS` (`backend/worker/src/config/env.js`)
- **Git Status:** Verified existing Git repository at project root (`Visualizer`). `git status --short --ignored` confirms `backend/worker/.env.local`, `node_modules/`, `frontend/dist/`, `renders/`, and `test-results/` are ignored (`!!`), `git ls-files` confirms `40` tracked files with `.env.local` untracked/ignored, and `git check-ignore -v` verified ignore/tracking behavior across `.env*`, `renders/`, `temp/`, `dist/`, `frontend/public/favicon.svg`, `frontend/src/assets/`, `fixtures/mermaid/`, and `docs/spikes/`.

---

## 2. Configuration Corrections Applied

1. **Removed Unused Frontend & Express Backend Env Variables:**
   - Cleared unused `VITE_API_BASE_URL` from `frontend/.env.example` and removed unused `frontend/.env.local`.
   - Cleared unused `NODE_ENV`, `PORT`, and `FRONTEND_ORIGIN` from `backend/.env.example` and removed unused `backend/.env.local`.
2. **Removed Docker & Deferred Infrastructure Config from Phase 0:**
   - Removed `docker-compose.spike.yml`, `backend/worker/Dockerfile`, `backend/worker/src/scripts/runDockerSmoke.js`, `spike:docker` / `spike:docker-smoke` npm scripts, and Docker browser path instructions from `backend/worker/.env.example` (Docker is officially excluded from Phase 0).
   - Removed unused `NODE_ENV` from `backend/worker/.env.example`.
   - Kept Redis, BullMQ, Supabase Auth/DB/Storage, upload limits, quotas, and Sentry deferred to Phase 1+.
3. **Hardened `.gitignore`:**
   - Ignores `node_modules/`, `dist/`, `build/`, `.vite/`, `coverage/`, `*.lcov`, `.nyc_output/`, `test-results/`, `playwright-report/`, `.env`, `.env.local`, `.env.*.local`, `.env.*`, `*.env`, `*.env.local`, `*.pem`, `*.key`, `logs/`, `*.log`, and temporary render folders (`temp/`, `tmp/`, `.tmp/`, `renders/`, `backend/worker/temp/`, `backend/worker/tmp/`, `backend/worker/output/`).
   - Preserves trackability for `.env.example`, `*.env.example`, `!frontend/src/assets/**`, `frontend/public/favicon.svg`, and `fixtures/mermaid/*.mmd`.
   - Removed obsolete `!.env.docker.example` exception.

---

## 3. Active Phase 0 Environment Variables

### `backend/worker/.env.example`

| Variable | Classification | Consumer | Purpose | Default / Placeholder |
| :--- | :--- | :--- | :--- | :--- |
| `GEMINI_API_KEY` | **Private Secret** (server-only) | `env.js` → `@google/genai` | Authenticates live Gemini structured plan generation (`npm run spike:gemini`). | `YOUR_GEMINI_API_KEY` |
| `GEMINI_MODEL` | **Server Config** (non-secret) | `env.js`, `geminiPlanner.js` | Pinned Gemini model identifier. | `gemini-3.5-flash` |
| `EXCALIDRAW_BROWSER_PATH` | **Local Infrastructure Path** | `env.js`, `cliRenderer.js` | Explicit Chrome/Chromium/Edge path for headless `@excalidraw/cli` execution. Falls back to OS auto-detection if unset or cross-OS mismatch. | `C:\Program Files\Google\Chrome\Application\chrome.exe` |
| `CLI_RENDER_TIMEOUT_MS` | **Server Config** (non-secret) | `env.js` → `cliRenderer.js` | Bounded timeout (`1000..120000` ms) for CLI subprocesses. | `30000` |

### `frontend/.env.example` & `backend/.env.example`
Both files are retained as documented placeholders containing **0 active variables** for Phase 0; variables for the Vite-to-Express API connection and Supabase Auth/DB will be added when Phase 1 begins.

---

## 4. Local Environment Setup & Secret Verification

1. **Create Worker Env File:**
   ```powershell
   Copy-Item backend\worker\.env.example backend\worker\.env.local
   ```
   Set `GEMINI_API_KEY` to a real Google AI Studio key and verify `EXCALIDRAW_BROWSER_PATH` for your OS (Windows Chrome/Edge, Linux/WSL `/usr/bin/chromium`, macOS `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`).
2. **Loader Behavior:** `backend/worker/src/config/env.js` explicitly loads `backend/worker/.env.local` using `import.meta.dirname`, so `npm run spike:gemini` and `npm test` resolve variables identically regardless of working directory.
3. **Tracked & Frontend Bundle Secret Audit:**
   - Scanned all `40` Git-tracked text files (`git ls-files`) for real API keys/service-role credentials: `0` real secret patterns found (`backend/worker/.env.local` is untracked and ignored by Git).
   - Built `frontend/dist/` and scanned all generated assets. Zero Visualify secrets (`GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, or user keys) appear in `frontend/dist/`. (One upstream `REACT_APP_FIREBASE_CONFIG` string exists inside `@excalidraw/excalidraw` itself for Excalidraw.com's public relay.)
