# Visualify — Phase 0 Technical Spike Report & Acceptance Matrix

**Date:** 25 November 2026  
**Overall Phase 0 Status:** **PASS** *(Docker officially excluded from Phase 0 scope; all mandatory Phase 0 requirements implemented, executed, and verified locally.)*

---

## 1. Executive Summary

The Phase 0 technical spike proved the end-to-end feasibility of Visualify's core pipeline locally on Windows + Node.js `v22.19.0`:

`Gemini API (gemini-3.5-flash) → Structured Learning Plan → Zod Validation → Deterministic Scene Adapter / Mermaid CLI → Editable Excalidraw Scene → PNG/SVG Export & React Excalidraw Editor`

All 7 PRD-supported diagram types (`flowchart`, `sequence`, `mindmap`, `comparison`, `timeline`, `er_diagram`, `class_diagram`) were converted into editable Excalidraw scenes, exported to PNG and SVG via `@excalidraw/cli` with headless Chrome, visually inspected, and loaded into the `@excalidraw/excalidraw` React editor via Playwright with zero runtime or console errors.

*(Per architectural decision, Docker and Docker Compose were removed from Phase 0 scope and acceptance criteria.)*

---

## 2. Final Repository Structure & Environment

```text
Visualizer/
├── backend/
│   ├── .env.example                 (Phase 1+ placeholder; 0 active Phase 0 vars)
│   └── worker/
│       ├── src/
│       │   ├── adapters/            (directSceneAdapter.js, mermaidAdapter.js, sceneRouter.js)
│       │   ├── config/              (env.js)
│       │   ├── renderer/            (cliRenderer.js)
│       │   ├── schemas/             (excalidrawScene.js, learningPlan.js)
│       │   ├── scripts/             (runLocalSpike.js, runGeminiSpike.js)
│       │   └── services/            (geminiPlanner.js)
│       ├── tests/                   (adapters.test.js, cliRenderer.test.js, geminiPlanner.test.js, learningPlan.test.js)
│       ├── .env.example
│       ├── .env.local               (local developer secrets; gitignored)
│       └── package.json
├── docs/spikes/
│   ├── README.md
│   ├── environment-configuration-audit.md
│   ├── phase-0-decisions.md
│   └── phase-0-spike-report.md
├── fixtures/mermaid/                (flowchart.mmd, sequence.mmd)
├── frontend/
│   ├── public/favicon.svg
│   ├── src/                         (App.jsx, main.jsx, sampleScene.js)
│   ├── .env.example                 (Phase 1+ placeholder; 0 active Phase 0 vars)
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── tests/e2e/excalidraw.spec.js
├── .gitignore
├── package.json
├── package-lock.json
└── playwright.config.js
```

| Component | Verified Version |
| :--- | :--- |
| **Supported Node.js** | `>=22.0.0` (verified on `v22.19.0`, `npm 10.9.3`) |
| **OS / Local Browser** | Windows (`win32`), Google Chrome (`C:\Program Files\Google\Chrome\Application\chrome.exe`) |
| **Frontend** | `react@18.3.1`, `react-dom@18.3.1`, `@excalidraw/excalidraw@0.18.1`, `vite@8.3.8`, `@vitejs/plugin-react@6.3.0` |
| **Worker** | `@excalidraw/cli@1.1.2`, `@google/genai@3.6.1`, `zod@4.6.7`, `dotenv@18.0.10` |
| **Testing** | `vitest@5.1.1`, `@playwright/test@1.65.1` |
| **Gemini Model** | `gemini-3.5-flash` |

---

## 3. Setup, Required Environment Variables & Commands

### Setup
```powershell
npm install
Copy-Item backend\worker\.env.example backend\worker\.env.local
```
Set `GEMINI_API_KEY` in `backend/worker/.env.local` (required only for `npm run spike:gemini`) and verify `EXCALIDRAW_BROWSER_PATH` matches your local Chrome/Chromium/Edge binary.

### Required Environment Variables (Phase 0)
- **Frontend (`frontend/.env.example`):** None active in Phase 0 (`0` `import.meta.env` usages).
- **Backend API (`backend/.env.example`):** None active in Phase 0 (Express API begins in Phase 1).
- **Generation Worker (`backend/worker/.env.example`):**
  - `GEMINI_API_KEY` (Private server secret)
  - `GEMINI_MODEL` (`gemini-3.5-flash`)
  - `EXCALIDRAW_BROWSER_PATH` (Local Chrome/Chromium/Edge path)
  - `CLI_RENDER_TIMEOUT_MS` (`30000`)

### Verification & Rendering Commands
- **Unit + Local CLI Integration Tests (offline, no API key needed):** `npm test`
- **Browser E2E Test (Playwright + Chrome):** `npm run test:e2e`
- **Local End-to-End Spike (all 7 diagram types → `.excalidraw`, `.png`, `.svg` in `renders/`):** `npm run spike:local`
- **Live Gemini End-to-End Spike (requires `GEMINI_API_KEY`):** `npm run spike:gemini`
- **Frontend Dev Server / Production Build:** `npm run dev:frontend` / `npm run build:frontend`

To verify PNG/SVG exports manually after `npm run spike:local`:
- Inspect `renders/*.png` (validates PNG `89 50 4E 47` magic bytes and non-zero IHDR dimensions) and `renders/*.svg` (contains `<svg`), or load `renders/*.excalidraw` into `npm run dev:frontend`.

---

## 4. Live Gemini API Evaluation

Historical live measurements recorded on `25 November 2026` using `gemini-3.5-flash` via `npm run spike:gemini` (key redacted):

| Prompt | Model | Repaired | Latency (ms) | Tokens (Prompt / Output / Thought / Total) | Generated Sections & Strategies |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `"Explain the TCP three-way handshake."` | `gemini-3.5-flash` | `false` | `28473` | `232 / 713 / 1259 / 2204` | `tcp-sequence-exchange` (`sequence` / `mermaid`, 16 elements)<br>`tcp-state-flow` (`flowchart` / `mermaid`, 20 elements) |
| `"Explain database normalization, including 1NF, 2NF and 3NF."` | `gemini-3.5-flash` | `false` | `32978` | `241 / 744 / 1219 / 2204` | `normalization-flow` (`flowchart` / `mermaid`, 14 elements)<br>`normal-forms-comparison` (`comparison` / `direct_scene`, 25 elements) |

**Observed Model & Schema Limitations:**
- `gemini-2.5-flash` returned HTTP `404` (`"no longer available to new users"`).
- `gemini-3.8-flash` and `gemini-3.7-flash` returned transient HTTP `503 UNAVAILABLE` during testing.
- Gemini's structured-output FSM compiler rejected `minItems`/`maxItems`/`additionalProperties` inside a 7-branch union (`HTTP 400`); `sanitizeForGemini()` strips those keywords for the transport schema (`4,681` bytes) while keeping strict runtime Zod enforcement on the server.
- Thinking tokens (`~1,219–1,259`) produce `~28–33s` total latency, confirming async job orchestration is required in Phase 2.

---

## 5. Supported Diagram Types & Local Rendering Benchmarks

Measured locally via `npm run spike:local` (Node `v22.19.0` + `@excalidraw/cli@1.1.2` + Google Chrome) and visually inspected:

| PRD Visual Type | Adapter Strategy | Elements & Types | Build / Convert (ms) | PNG Size / Latency | SVG Size / Latency | Visual Inspection Outcome |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `flowchart` | Mermaid → CLI | `17` (`rectangle`, `diamond`, `arrow`, `text`) | `1755` | `45,797 B` / `1699 ms` | `18,730 B` / `1798 ms` | **PASS** — clean branches, readable labels |
| `sequence` | Mermaid → CLI | `16` (`rectangle`, `line`, `arrow`, `text`) | `1886` | `28,914 B` / `1996 ms` | `14,479 B` / `1681 ms` | **PASS** — clear actors, lifelines, SYN/ACK arrows |
| `mindmap` | Direct Scene JS | `29` (`rectangle`, `text`, `arrow`) | `3` | `112,121 B` / `1830 ms` | `29,520 B` / `2018 ms` | **PASS** — balanced left/right color-coded branches |
| `comparison` | Direct Scene JS | `17` (`rectangle`, `text`) | `1` | `140,464 B` / `1711 ms` | `24,404 B` / `1883 ms` | **PASS** — aligned columns, wrapped text cards |
| `timeline` | Mermaid → CLI | `26` (`rectangle`, `ellipse`, `arrow`, `text`) | `1692` | `77,076 B` / `1668 ms` | `31,257 B` / `1809 ms` | **PASS** — horizontal axis, color-coded period cards |
| `er_diagram` | Mermaid → CLI | `20` (`rectangle`, `line`, `arrow`, `text`) | `1940` | `30,939 B` / `1683 ms` | `15,957 B` / `1647 ms` | **PASS** — clean entity boxes (`USER`, `NOTE`), crow's foot cardinality |
| `class_diagram` | Mermaid → CLI | `15` (`rectangle`, `line`, `arrow`, `text`) | `1741` | `30,307 B` / `1679 ms` | `12,303 B` / `1698 ms` | **PASS** — class names, attributes, and `()` method signatures |

*(PRD Section 9.3 also lists `annotated_illustration` as conditional on asset sourcing and `multi_frame_lesson` as P1/Next-release.)*

---

## 6. Reconciled Test Counts

| Category | Command | Outcome | Breakdown |
| :--- | :--- | :--- | :--- |
| **Unit Tests** | `npm test` | **33 passed (0 failed, 0 skipped)** | `adapters.test.js` (9), `learningPlan.test.js` (10), `geminiPlanner.test.js` (9 mocked fault-injection), `cliRenderer.test.js` mocked unit suite (5). |
| **Integration Tests** | `npm test` | **5 passed (0 failed, 0 skipped)** | `cliRenderer.test.js` real local `@excalidraw/cli` + Chrome integration suite (5 tests covering all 7 diagram types, PNG magic/IHDR dimensions, SVG output, and invalid-Mermaid cleanup). |
| **Browser / E2E Tests** | `npm run test:e2e` | **1 passed (8.6s)** | Playwright + Chrome: canvas dimensions, `initialData` sample scene, interactive rectangle creation, loading all 7 generated `.excalidraw` scenes, zero console/page errors. |
| **Build Verification** | `npm run build:frontend` | **PASS (2.03s)** | Vite production bundle (`dist/`, `sourcemap: false`), zero Visualify secrets in bundle. |
| **Local Rendering Spike** | `npm run spike:local` | **7/7 fixtures passed** | Generated and verified `.excalidraw`, `.png`, and `.svg` for all 7 PRD visual types. |
| **Live Gemini API Spike** | `npm run spike:gemini` | **2/2 prompts passed** | Historical live verification with `gemini-3.5-flash` (`repaired: false`). |

---

## 7. Phase 0 Acceptance Matrix

| Requirement | Implementation Location | Verification Method | Command Executed | Actual Result | Relevant Test / Artifact | Status | Remaining Limitations |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Monorepo structure, locked deps & Phase 0 scripts | `package.json`, `package-lock.json`, `frontend/package.json`, `backend/worker/package.json` | Lockfile install & script execution | `npm test`, `npm run spike:local` | All workspaces resolve cleanly with pinned `react@18.3.1` | `package.json` | **PASS** | None |
| Secret & env audit (`.gitignore`, `.env.example`, bundle scan) | `.gitignore`, `backend/worker/.env.example`, `backend/worker/src/config/env.js` | File/env audit & bundle scan | `Select-String` secret scan + `npm run build:frontend` | `0` Visualify secrets in source or `frontend/dist/`; unused vars removed | `docs/spikes/environment-configuration-audit.md` | **PASS** | Git not initialized yet (`git ls-files`/`git check-ignore` unrun) |
| Gemini structured learning plan integration | `backend/worker/src/services/geminiPlanner.js` | Live API run + 9 fault-injection unit tests | `npm run spike:gemini`, `npm test` | 2 live prompts passed (`28.47s`, `32.98s`); 9/9 mock tests pass | `backend/worker/tests/geminiPlanner.test.js` | **PASS** | `2.5-flash` deprecated (`404`); `3.7/3.8` had `503` load spikes |
| Zod learning plan & edge-case validation | `backend/worker/src/schemas/learningPlan.js` | Unit validation tests | `npm test` | 10/10 schema tests pass (nulls, empty arrays, refs, limits) | `backend/worker/tests/learningPlan.test.js` | **PASS** | None |
| Deterministic scene adapters & scene validator | `backend/worker/src/adapters/*`, `backend/worker/src/schemas/excalidrawScene.js` | Unit tests + repeatability + visual PNG check | `npm test`, `npm run spike:local` | 9/9 adapter tests pass; deterministic output verified | `backend/worker/tests/adapters.test.js` | **PASS** | None |
| Mermaid conversion across all mandatory types | `backend/worker/src/adapters/mermaidAdapter.js`, `cliRenderer.js` | Real CLI conversion + PNG/SVG + visual check | `npm test`, `npm run spike:local` | Flowchart, sequence, timeline, ER, class all produce editable elements | `renders/{tcp-handshake,http-request-flow,timeline-evolution,er-data-model,class-architecture}.*` | **PASS** | None |
| Local headless Chromium CLI rendering & cleanup | `backend/worker/src/renderer/cliRenderer.js` | 5 unit + 5 real CLI integration tests | `npm test` | PNG magic/IHDR & SVG verified; temp dirs cleaned on success & failure | `backend/worker/tests/cliRenderer.test.js` | **PASS** | None |
| React + Excalidraw browser integration | `frontend/src/App.jsx`, `frontend/vite.config.js` | Playwright real Chrome E2E + Vite build | `npm run test:e2e`, `npm run build:frontend` | 1/1 E2E passed (canvas, drawing, all 7 scenes loaded, 0 errors); build `2.03s` | `tests/e2e/excalidraw.spec.js` | **PASS** | None |
