# Visualify — Phase 0 Architectural Decisions

**Date:** 25 November 2026  
**Status:** Baseline decisions locked from Phase 0 spike verification (`PRD.MD` Section 17.1 & 18.2)

---

## 1. Final Learning Plan Schema Design

- **Canonical Runtime Validator:** Zod v4 (`LearningPlanSchema` in `backend/worker/src/schemas/learningPlan.js`) enforces unique section/element IDs, valid edge/message/relation references, `visualType === diagramSpec.kind`, and bounded node/edge/branch complexity.
- **Gemini Transport Schema (`getLearningPlanGeminiJsonSchema`):** Generated via `z.toJSONSchema()` with grammar-bloating keywords (`$schema`, `minLength`, `maxLength`, `pattern`, `minItems`, `maxItems`, `additionalProperties`, `default`) stripped so Gemini's structured output FSM compiles cleanly while runtime Zod remains strict.
- **Contract Extension (`diagramSpec`):** Discriminated union across all 7 supported diagram kinds (`flowchart`, `sequence`, `mindmap`, `comparison`, `timeline`, `er_diagram`, `class_diagram`).
- **Error Recovery:** Transient provider errors (HTTP 5xx/network) use bounded exponential backoff (`maxTransientRetries = 2`); malformed/schema-invalid responses get at most **1** repair turn with Zod error guidance.

---

## 2. Local Headless Renderer Invocation Strategy

- **Local Binary Resolution:** Invoke the pinned local `@excalidraw/cli` entrypoint (`node_modules/@excalidraw/cli/dist/main.js`) directly via `process.execPath` (`node`) instead of spawning `npx` per request.
- **Subprocess Safety:** Use `child_process.execFile` with explicit argument arrays and `shell: false`. Use `fs.mkdtemp()` working directories and fixed internal filenames (`diagram.mmd`, `scene.excalidraw`, `export.png`, `export.svg`) cleaned up in `finally`.
- **Browser Resolution:** `resolveBrowserPath()` uses `EXCALIDRAW_BROWSER_PATH` if valid on disk and safely falls back to OS-installed Chrome/Chromium/Edge executables when cross-OS paths differ.
- **Verification:** Check PNG magic bytes (`89 50 4E 47 0D 0A 1A 0A`), non-zero IHDR dimensions, and `<svg` tag presence before returning buffers.

---

## 3. Mermaid vs. Direct Scene Routing

| Visual Type | Adapter Path | Visual & Editability Outcome |
| :--- | :--- | :--- |
| `flowchart`, `sequence`, `timeline`, `er_diagram`, `class_diagram` | **Mermaid Adapter → `@excalidraw/cli`** | All 5 verified to produce editable Excalidraw elements (0 `image` elements), readable labels, and valid PNG/SVG renders. Labels sanitized (`sanitizeMermaidLabel`), ER entity/attribute tokens cleaned, and class method `()` signatures preserved. |
| `mindmap`, `comparison` | **Direct Scene Adapter (`directSceneAdapter.js`)** | Deterministic JS layout calculates wrapped text metrics, balanced two-sided radial mind-map layout, aligned comparison columns, and bound arrows in `1–3 ms` without launching a browser. |

Every generated scene must pass `validateExcalidrawScene()` before rendering or UI loading.

---

## 4. Phase 0 Scope & Docker Exclusion

- **Docker Excluded from Phase 0:** Per architectural decision, containerization (`Dockerfile`, `docker-compose.spike.yml`) is removed from Phase 0 acceptance criteria and deferred to a later deployment phase if required. Local Node.js + headless Chrome/Chromium + `@excalidraw/cli` execution proves rendering feasibility.

---

## 5. Decisions Phase 1 Must Respect

1. **Pin React 18.3.1:** Keep `react` and `react-dom` pinned to `18.3.1` with `resolve.dedupe: ["react", "react-dom"]` in `frontend/vite.config.js` while `@excalidraw/excalidraw@0.18.1` relies on React-18-constrained `@radix-ui` dependencies.
2. **Async-Only AI & Render Architecture:** Live Gemini structured generation takes ~28–33s and CLI rendering takes ~1.7–2.0s per export; Phase 2 generation must run asynchronously rather than inside synchronous HTTP requests.
3. **Configurable Model Pinning:** Keep `GEMINI_MODEL` server-configured (`gemini-3.5-flash` verified working; `gemini-2.5-flash` returned `404` for new users; `3.7`/`3.8` experienced transient `503` load spikes).
4. **Canonical Scene Storage:** Store `.excalidraw` JSON as the canonical editable artifact and treat PNG/SVG as rendered derivatives.
