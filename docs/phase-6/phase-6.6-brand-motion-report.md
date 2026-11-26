# Phase 6.6 — Brand Identity, Signature Landing Page, Site-Wide Motion System, Production CSP Fix & README

> Close-out engineering report following `AGENTS.md` §1–§21 and `PRD.MD` (§13.1, §13.2, §17, §18.3, §21).

---

### 1. What was built

1. **Production CSP Fix & Canonical Origin Config ([PRD §21, AGENTS §21])**
   - Added [`deploy/origins.json`](../../deploy/origins.json) as the single source of truth for staging and production API & frontend origins (`OWNER-CONFIRM` before live cutover).
   - Fixed [`vercel.json`](../../vercel.json) `connect-src`: stripped `http://localhost:5000 https://localhost:5000` and permitted the Render staging & production API origins.
   - Extended [`frontend/src/lib/phase6.test.js`](../../frontend/src/lib/phase6.test.js) (`3 tests`) to enforce zero `localhost`/`127.0.0.1` entries, zero wildcards, exact pre-paint inline script SHA-256 hash parity with [`frontend/index.html`](../../frontend/index.html), and inclusion of every API origin declared in `deploy/origins.json`.
   - Updated [`scripts/smokeStaging.js`](../../scripts/smokeStaging.js) to assert deployed CSP headers exclude localhost and allow the target API origin alongside CORS checks, and synchronized [`docs/operations/runbook.md`](../operations/runbook.md) env tables (`VITE_API_BASE_URL`, `FRONTEND_ORIGIN`, `WORKER_HEALTH_PORT=5001`).

2. **Canonical BrandMark, Icons, Web Manifest & Self-Hosted Display Font ([PRD §13.1])**
   - Extracted canonical geometry into [`frontend/src/brand/markGeometry.js`](../../frontend/src/brand/markGeometry.js) driving both [`frontend/src/brand/BrandMark.jsx`](../../frontend/src/brand/BrandMark.jsx) (used via `Logo` across public/app navigation) and [`scripts/generateBrandAssets.js`](../../scripts/generateBrandAssets.js) (`npm run brand:assets`).
   - Generated complete web identity assets under `frontend/public/`: `favicon.svg` (light/dark adaptive via `@media (prefers-color-scheme: dark)`), `favicon-16.png`, `favicon-32.png`, multi-res `favicon.ico`, `apple-touch-icon.png` (`180x180`), `icon-192.png`, `icon-512.png`, `icon-512-maskable.png`, `og-image.png` (`1200x630`), `site.webmanifest`, optimized WebP diagram gallery assets (`frontend/public/diagrams/*.webp`), and self-hosted `@fontsource-variable/bricolage-grotesque@5.3.0` Latin subset (`/fonts/bricolage-grotesque-latin-wght-normal.woff2`) paired cleanly with `<link rel="preload">` and canonical/OG metadata in `frontend/index.html`.
   - Added [`frontend/src/brand/BrandMark.test.jsx`](../../frontend/src/brand/BrandMark.test.jsx) (`4 tests`) covering `role="img"`, `<title>`, `aria-hidden` decorative mode, `default`/`mono`/`inverse` variants, and shared SVG geometry.

3. **Design System & Site-Wide Accessible Motion Architecture ([PRD §13.1, §13.2])**
   - Published [`docs/design/DESIGN.md`](../design/DESIGN.md) codifying color tokens (warm paper `#faf8f5`, charcoal ink `#12100e`, deep teal `#0f766e` / `#2dd4bf`, diagram spark indigo `#4f46e5` / amber `#d97706`, hero surface `#072220`), verified WCAG 2.2 AA/AAA contrast ratios (`4.80:1`–`17.49:1`), type scale, elevation, and 3-tier motion policy (`Expressive`, `Calm-but-Alive`, `Focus`).
   - Added zero-dependency motion tokens, `@starting-style` transitions (`Modal`, `ActionMenu`, `ThemeToggle`), React Router 7 `viewTransition` links, shimmer skeletons, CSS Grid `0fr -> 1fr` `<Collapse>`, shared `<SlidingIndicator>`, progressive scroll `<Reveal>`, `<Float>`, `useReducedMotion`, and `useCountUp` under `frontend/src/motion/` and `frontend/src/styles/index.css`.
   - Wired motion tiers site-wide across `AppShell`, `PublicLayout`, `AuthLayout`, `NotFoundPage`, `FeaturesPage`, `DashboardPage`, `LibraryPage`, `GenerationProgress`, `NoteReadPage`, `FlashcardsView`, `RevisionSheetView`, `AdminMetricsPage`, and focus-only status/strip feedback inside `NoteEditorPage` / `NotePresentPage`.
   - Added [`frontend/src/motion/motion.test.jsx`](../../frontend/src/motion/motion.test.jsx) (`4 tests`) verifying SSR/no-JS visibility, `prefers-reduced-motion` immediate count-up settlement, and `Collapse` / `Float` markup.

4. **Signature Landing Page & Interactive Product Previews ([PRD §13.1, §4])**
   - Decomposed [`frontend/src/features/marketing/LandingPage.jsx`](../../frontend/src/features/marketing/LandingPage.jsx) into focused modules under `frontend/src/features/marketing/landing/`: `Hero`, `HeroStage` (preserving interactive 4-format Sequence/Flowchart/Mind map/Comparison switcher & Light/Dark canvas preview without importing `@excalidraw/excalidraw`), `WaveDivider`, `InputsStrip`, `HowItWorks`, `StudyDemo`, `DiagramMarquee` (WCAG 2.2.2 hover/focus pause + explicit Pause toggle button + reduced-motion static grid), `PrivacyBand`, and `FinalCta`.
   - Updated [`frontend/src/features/marketing/FeaturesPage.jsx`](../../frontend/src/features/marketing/FeaturesPage.jsx) so live Phase 5/6 learning tools show `Available now` (`10` live items; Phase 7 remains `Coming later`).

5. **Reproducible Screenshots, Environment/README Parity Validators & Rewritten `README.md`**
   - Created [`scripts/captureReadmeScreenshots.js`](../../scripts/captureReadmeScreenshots.js) (`npm run docs:screenshots`) generating PII-free light/dark desktop (`1440px`), mobile (`390px`), workspace, dashboard, study, present, and `BrandMark` `16/24/32/64px` visual captures into `docs/assets/`.
   - Created [`scripts/checkEnvDocs.js`](../../scripts/checkEnvDocs.js) & [`scripts/checkReadme.js`](../../scripts/checkReadme.js) and wired both into [`scripts/lint.js`](../../scripts/lint.js) so every commit/CI check enforces schema-to-doc parity (`29` API vars, `6` worker vars, `4` frontend vars), link/asset existence, Mermaid validity, and line budget (`323` lines).
   - Updated `backend/.env.example` with the previously undocumented split-role & logging schema variables (`PROCESS_ROLE`, `WORKER_HEALTH_PORT`, `SHUTDOWN_GRACE_MS`, `LOG_LEVEL`) and rewrote `README.md`.

---

### 2. Important technical decisions

- **GPU transform-only `<Reveal>` (preserving `opacity: 1`):** Initial Playwright Axe runs revealed that animating `opacity: 0 -> 1` on scroll/staggered wrappers caused transient `color-contrast` violations whenever Axe scanned immediately after mount (`bgColor`/`fgColor` alpha blending mid-transition) or on elements waiting below the fold. Switching `.vf-reveal` to compositor-only `translate3d` (`transform` only, `opacity: 1` always) guarantees zero layout shift, immediate readability without JS or `IntersectionObserver`, and 100% WCAG contrast at every millisecond.
- **No external animation dependencies:** Preserved `react@18.3.1` and zero-bloat constraints by implementing all choreography via CSS tokens, `linear()` springs, `@starting-style`, CSS Grid `0fr -> 1fr`, `IntersectionObserver`, and React Router 7 `viewTransition`. Entry chunk growth stayed `+6.86 kB` gzip (`251.17 kB -> 258.03 kB`), keeping Excalidraw (`WorkspaceCanvas`, `345.06 kB` gzip) completely excluded from `/` and marketing routes.
- **Honest E2E test updates (2 targeted lines):**
  1. `tests/e2e/app-shell.spec.js:31`: updated `"Available now"` count expectation from `9` to `10` because `FeaturesPage.jsx` now accurately reflects shipped Phase 5/6 learning tools.
  2. `tests/e2e/phase6.5.spec.js:49-50`: switched immediate array count assertion after rapid radio-button clicks to Playwright `expect.poll(...)` to eliminate an asynchronous React Query fetch race.
- **Proposed PRD §13.1 Amendment Note (documented rather than editing `PRD.MD` directly):**
  > *Proposed PRD §13.1 Visual Language Addendum:* Visualify extends its warm neutral/deep-teal baseline (`#faf8f5` / `#12100e` surfaces, `#0f766e` / `#2dd4bf` primary accent) with restrained diagram spark accents (indigo `#4f46e5`, amber `#d97706`), a dark-teal marketing hero band (`#072220`), self-hosted `Bricolage Grotesque Variable` display typography (`font-display`), and the unified three-tier CSS motion system (`Expressive`, `Calm-but-Alive`, `Focus`) while preserving light/dark Excalidraw editing clarity and full `prefers-reduced-motion` compliance.

---

### 3. Files changed / created

- **Brand & Public Assets:** `frontend/src/brand/{markGeometry.js, BrandMark.jsx, BrandMark.test.jsx}`, `frontend/public/{favicon.svg, favicon.ico, favicon-16.png, favicon-32.png, apple-touch-icon.png, icon-192.png, icon-512.png, icon-512-maskable.png, og-image.png, site.webmanifest, fonts/bricolage-grotesque-latin-wght-normal.woff2, diagrams/*.webp}`, `frontend/index.html`, `frontend/src/components/Layout.jsx`.
- **Design & Motion System:** `docs/design/DESIGN.md`, `frontend/src/styles/index.css`, `frontend/src/main.jsx`, `frontend/src/motion/{index.js, Reveal.jsx, Float.jsx, Collapse.jsx, SlidingIndicator.jsx, useReducedMotion.js, useInView.js, useCountUp.js, viewTransitions.js, motion.test.jsx}`.
- **UI Components & Routes:** `frontend/src/components/{Button.jsx, Menu.jsx, Modal.jsx, SegmentedControl.jsx, ThemeToggle.jsx}`, `frontend/src/app/AppShell.jsx`, `frontend/src/features/dashboard/DashboardPage.jsx`, `frontend/src/features/notes/{LibraryPage.jsx, NoteReadPage.jsx, NoteEditorPage.jsx, NotePresentPage.jsx}`, `frontend/src/features/notes/study/{FlashcardsView.jsx, RevisionSheetView.jsx}`, `frontend/src/features/generation/GenerationProgress.jsx`, `frontend/src/features/admin/AdminMetricsPage.jsx`, `frontend/src/features/auth/AuthLayout.jsx`, `frontend/src/features/marketing/{PublicLayout.jsx, LandingPage.jsx, FeaturesPage.jsx, NotFoundPage.jsx}`, `frontend/src/features/marketing/landing/{Hero.jsx, HeroStage.jsx, WaveDivider.jsx, InputsStrip.jsx, HowItWorks.jsx, StudyDemo.jsx, DiagramMarquee.jsx, PrivacyBand.jsx, FinalCta.jsx}`.
- **CSP, Config, Docs & Tests:** `deploy/origins.json`, `vercel.json`, `scripts/{generateBrandAssets.js, captureReadmeScreenshots.js, checkEnvDocs.js, checkReadme.js, lint.js, smokeStaging.js}`, `package.json`, `frontend/package.json`, `frontend/vite.config.js`, `package-lock.json`, `backend/.env.example`, `docs/operations/runbook.md`, `docs/assets/{hero-*, dashboard-*, workspace-*, study-*, create.png, present-dark.png, brand-strip.png}`, `README.md`, `tests/e2e/{brand.spec.js, landing.spec.js, motion.spec.js, perf.spec.js, app-shell.spec.js, phase6.5.spec.js}`, `frontend/src/lib/phase6.test.js`.

---

### 4. Verification & Measurements (Post-Final-Edit)

| Check | Result | Details |
| :--- | :--- | :--- |
| `npm run lint` | **PASS** | `134` JS files syntax-checked, pinned deps verified, zero frontend secrets, `checkEnvDocs` (`29` API + `6` worker + `4` frontend vars), `checkReadme` (`323` lines, `2` Mermaid blocks, `34` refs) |
| `npm run test:worker` | **PASS (95/95)** | `9` files including live Chromium `@excalidraw/cli` scene/PNG/SVG renders |
| `npm run test:api` | **PASS (242/242)** | `14` files (auth, security, quotas, metrics, generation, notes) |
| `npm run test:rls:sql` | **PASS (68/68)** | `6` PGlite suites covering Phases 1–6.5 policies & `product_events` |
| `npm run test:frontend` | **PASS (84/84)** | `9` files (`phase6.test.js` CSP, `BrandMark.test.jsx`, `motion.test.jsx`, schema/SSE tests) |
| `npm run test:rls:live` | **PASS (22/22)** | `0` failures, `0` skipped against live Supabase schema (`0001`–`0010`) |
| `npm run build:frontend` | **PASS** | Entry JS: `895.55 kB` / **`258.03 kB` gzip** (`+6.86 kB` gzip over baseline `251.17 kB`); CSS: `61.15 kB` / `11.87 kB` gzip; `0` `.map` files in `dist/` |
| `npm run test:e2e` | **PASS (85/85)** | Full Playwright suite across light/dark desktop & mobile + Axe WCAG 2.2 AA (`0` violations) + `brand`, `landing`, `motion`, and 4x CPU-throttled `perf` (`CLS < 0.05`, zero Excalidraw chunks on `/`) |
| **3 Temporary Mutation Checks** | **3/3 Caught** | (1) Injecting `http://localhost:5000` into `vercel.json` CSP failed `phase6.test.js`; (2) removing `inView` in `Reveal.jsx` failed `motion.test.jsx`; (3) ignoring `reducedMotion` in `computeCountUpStep` failed `motion.test.jsx`. All 3 cleanly restored and re-verified green |

---

### 5. Remaining issues & Owner Actions (`OWNER-CONFIRM`)

- **Deployment Origin Confirmation (`OWNER-CONFIRM`):** Confirm or update the Render/Vercel hostnames in [`deploy/origins.json`](../../deploy/origins.json) and keep `vercel.json` `connect-src` synchronized before promoting staging -> production.
- **Carried-over Manual Launch Items (Phase 6.5 Owner-Only):** Dashboard provisioning/DNS setup on Vercel & Render, live Redis attachment, Google OAuth consent verification, production Supabase Auth redirect URLs, legal counsel sign-off on `/privacy` & `/terms`, and live `npm run smoke:staging` execution after deploying staging/production.
- **Working Tree:** Left uncommitted intentionally per phase instructions (review diff via `git status` before committing).

---

### 6. Next priority

1. Review the uncommitted changes (`git status` / `git diff`) and commit cleanly to `main`.
2. Confirm exact staging/production URLs in `deploy/origins.json`, deploy Render (`api` + `worker` + Redis) and Vercel SPA, and run `npm run smoke:staging` against live hosts.
