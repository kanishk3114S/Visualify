# Visualify Design & Motion System

> Single design reference for every public page, workspace view, study mode, and interactive control in Visualify.

---

## 1. Brand Personality & Visual Metaphor

**Warm paper, ink, and diagram spark.**
Visualify sits between an academic notebook and a clean diagramming table: grounded warm neutrals (`#faf8f5` paper canvas light / `#12100e` charcoal ink dark), disciplined deep-teal primary action (`#0f766e` light / `#2dd4bf` dark), and expressive indigo/amber diagram sparks reserved strictly for diagram connectors, learning mode tags, and spotlight callouts.

- **Brand Mark (`frontend/src/brand/BrandMark.jsx`):** Two connected node cards joined by dual orthogonal flow paths and punctuated by a top-right amber spark node (`#f59e0b`). Shared geometry (`frontend/src/brand/markGeometry.js`) drives the in-app `<Logo>`, `/favicon.svg` (light/dark adaptive), `/favicon-{16,32}.png`, `/favicon.ico`, `/apple-touch-icon.png`, manifest icons, and `/og-image.png`.
- **Editorial Contrast:** Expressive hero bands use deep dark teal (`#072220`) paired with expressive display typography (`Bricolage Grotesque Variable`), giving the marketing entrance unmistakable depth while keeping editing canvases quiet and glare-free.
- **Kinetic Qualities Note:** We study the playful energy of developer/creator-first landing pages (characterful display type, kinetic stage depth, subtle organic springs, clean modular surfaces) — while 100% of Visualify's assets, brand mark, color tokens, diagram copy, SVGs, and code remain strictly original. No third-party logos, copyrighted artwork, or unverified claims.

---

## 2. Color Palette & Verified Contrast

All foreground/background pairs satisfy **WCAG 2.2 AA (>= 4.5:1 text, >= 3:1 large display/UI)**. Ratios below were measured directly with relative luminance calculations (`L1/L2`).

### Semantic Surface & Accent Tokens

| Token | Role | Light Value | Dark Value |
| :--- | :--- | :--- | :--- |
| `--color-canvas` | Page backdrop | `#faf8f5` | `#12100e` |
| `--color-surface` | Cards, panels, menus, inputs | `#ffffff` | `#1c1a17` |
| `--color-hero` | Signature dark hero canvas | `#072220` | `#072220` |
| `--color-accent-700` | Primary button / focus ring / links | `#0f766e` | `#2dd4bf` |
| `--color-on-accent` | Label on filled primary button | `#ffffff` | `#04211e` |
| `--color-spark-indigo` | Secondary diagram / quiz highlight | `#4f46e5` | `#818cf8` |
| `--color-spark-indigo-soft` | Subtle indigo badge fill | `#eef2ff` | `#1e1b4b` |
| `--color-spark-indigo-ink` | Text on soft indigo badge | `#312e81` | `#e0e7ff` |
| `--color-spark-amber` | Diagram spark / node callout | `#d97706` | `#fbbf24` |
| `--color-spark-amber-soft` | Subtle amber badge fill | `#fef3c7` | `#2a1f0a` |
| `--color-spark-amber-ink` | Text on soft amber badge | `#78350f` | `#fde68a` |
| `--brand-bg` / `--brand-spark` | Adaptive BrandMark fills | `#0f766e` / `#f59e0b` | `#0d9488` / `#fbbf24` |

### Verified WCAG 2.2 Contrast Pairs

| Pair | Contrast Ratio | Standard |
| :--- | :--- | :--- |
| Light primary text (`#1c1917`) on Canvas (`#faf8f5`) | **16.50:1** | AAA |
| Light primary text (`#1c1917`) on Surface (`#ffffff`) | **17.49:1** | AAA |
| Light secondary text (`#57534e`) on Canvas (`#faf8f5`) | **7.20:1** | AAA |
| Light muted caption (`#78716c`) on Surface (`#ffffff`) | **4.80:1** | AA |
| Light primary button text (`#ffffff`) on Accent-700 (`#0f766e`) | **5.47:1** | AA (Large AAA) |
| Light accent link (`#0f766e`) on Canvas (`#faf8f5`) | **5.16:1** | AA |
| Light spark-indigo ink (`#312e81`) on Soft Indigo (`#eef2ff`) | **10.22:1** | AAA |
| Light spark-amber ink (`#78350f`) on Soft Amber (`#fef3c7`) | **8.15:1** | AAA |
| Hero headline (`#ffffff`) on Hero Canvas (`#072220`) | **16.68:1** | AAA |
| Hero highlight (`#5eead4`) on Hero Canvas (`#072220`) | **11.28:1** | AAA |
| Hero subcopy (`#d6d3d1`) on Hero Canvas (`#072220`) | **11.20:1** | AAA |
| Dark primary text (`#f5f3f1`) on Dark Canvas (`#12100e`) | **17.15:1** | AAA |
| Dark secondary text (`#d6d1cc`) on Dark Surface (`#1c1a17`) | **11.45:1** | AAA |
| Dark muted text (`#aaa39d`) on Dark Surface (`#1c1a17`) | **6.97:1** | AA+ |
| Dark button text (`#04211e`) on Dark Accent-600 (`#2dd4bf`) | **9.09:1** | AAA |
| Dark accent link (`#5eead4`) on Dark Surface (`#1c1a17`) | **11.74:1** | AAA |
| Dark spark-indigo ink (`#e0e7ff`) on Dark Soft Indigo (`#1e1b4b`) | **12.98:1** | AAA |
| Dark spark-amber ink (`#fde68a`) on Dark Soft Amber (`#2a1f0a`) | **12.98:1** | AAA |

---

## 3. Typography & Hierarchy

- **Display (`--font-display`):** Self-hosted `Bricolage Grotesque Variable` (Latin woff2 subset preloaded from `/fonts/bricolage-grotesque-latin-wght-normal.woff2`, weights `200..800`) backed by a metric-matched `@font-face "Bricolage Fallback"` (`size-adjust: 102%`) to prevent font-swap CLS. Used exclusively on marketing headlines (`<h1>`, `<h2>`), section eyebrows/brand wordmark, and large hero metrics.
- **UI & Long-form (`--font-sans`):** System UI stack for maximum legibility inside dense study tools, forms, and Excalidraw overlays.
- **Scale & Tracking:**
  - Hero Display `h1`: `clamp(2.25rem, 4.6vw, 3.85rem)` / `leading-[1.06]` / `tracking-[-0.03em]`
  - Section Title `h2`: `clamp(1.625rem, 2.8vw, 2.35rem)` / `leading-[1.15]` / `tracking-[-0.025em]`
  - Card / Feature `h3`: `1.125rem` (`18px`) / `font-semibold` / `tracking-[-0.015em]`
  - Body Copy: `1rem` (`16px`) marketing, `0.875rem`–`0.9375rem` dense workspace controls; `tabular-nums` for all counters, metrics, and quiz timers.

---

## 4. Layout Rhythm, Elevation & Radius

- **Grid & Widths:** Max container width `max-w-6xl` (`72rem` / `1152px`) for marketing & library grids, `max-w-4xl` (`896px`) for note study/reading focus, full-bleed viewport (`desk: 75rem` breakpoint) for workspace editing.
- **Radii:** Cards & panels `rounded-2xl` (`16px`), inputs/buttons `rounded-lg` (`8px`) or `rounded-xl` (`12px`), pills `rounded-full`.
- **Elevation:** Flat paper surfaces with hairline borders (`border-stone-200 dark:border-stone-800`) inside work surfaces; restrained tinted shadows (`shadow-lg`, `shadow-xl`) only on floating overlays, modals, and marketing spotlight stage cards.

---

## 5. Motion Architecture & Surface Tiers

**Zero new animation dependencies.** All motion runs on CSS tokens, `linear()` organic easing, `@starting-style`, CSS Grid `0fr -> 1fr`, `IntersectionObserver`, React Router 7 `viewTransition`, and compositor-only transforms (`transform`, `opacity`, `clip-path`).

### Timing & Easing Tokens

- `--duration-micro`: `120ms` — tactile presses (`active:scale-[0.98]`), icon ticks, star pops.
- `--duration-ui`: `190ms` — segmented indicator slides, collapse drawers, hover lifts, save-status pills.
- `--duration-enter`: `440ms` — scroll reveals, dialog entry (`@starting-style`), dashboard card staggers.
- `--duration-float`: `7000ms` — subtle sinusoidal idle float on marketing input cards.
- `--ease-out`: `cubic-bezier(0.16, 1, 0.3, 1)` — fast initial acceleration, smooth long settle.
- `--ease-spring`: `linear(...)` spring curve with gentle 1-bounce settle for interactive badges and stage morphs.

### Surface Motion Tiers

| Tier | Applies To | Behaviour |
| :--- | :--- | :--- |
| **1. Expressive** | `/`, `/features` | Staggered scroll reveals (`<Reveal>`), idle float cards (`<Float>`), self-drawing SVG sketch stage, scroll-synced pipeline rail, flippable study demo card, continuous pauseable marquee (`<DiagramMarquee>` with explicit Pause control per WCAG 2.2.2). |
| **2. Calm-but-Alive** | `/dashboard`, `/library`, `/create`, `/generate/:id`, `/notes/:id/study*`, `/admin/metrics`, `/auth/*`, `404` | Crisp functional motion only: `<SlidingIndicator>` on tabs/nav, `<Collapse>` height accordions, `useCountUp` metrics, `<Reveal>` initial stagger (`<= 4` items / small offset), 3D flashcard flip (opacity crossfade under reduced motion), calm `<= 1Hz` generation progress indicator. Never distracting ambient loops. |
| **3. Focus** | `/notes/:id/edit` (Excalidraw canvas), `/notes/:id/present` | **Zero ambient or canvas interference.** Excalidraw owns the canvas uninterrupted. Only functional UI status transitions (save-status pill morph, inspector drawer slide, presentation slide strip indicator) animate cleanly. |

### Motion Primitives (`frontend/src/motion/`)

- `useReducedMotion()` — reactive `(prefers-reduced-motion: reduce)` media hook (safe during SSR/no-window).
- `useInView(options)` — one-shot `IntersectionObserver` reveal trigger (`rootMargin: "-40px"` fallback to visible when observer is absent or reduced motion is active).
- `useCountUp(target, duration)` — `requestAnimationFrame` count-up (`tabular-nums`); jumps immediately to `target` when `reducedMotion` is true.
- `<Reveal>` — wraps sections/cards; **visible by default (`opacity: 1`)** and transitions only when `document.documentElement.dataset.motion === "ready"` and not reduced-motion. Zero flash of invisible content without JS.
- `<Float>` — smooth CSS composite ambient drift on marketing input cards, disabled cleanly under reduced motion.
- `<Collapse>` — pure CSS Grid `grid-template-rows: 0fr -> 1fr` disclosure wrapper synced with `aria-hidden` / interactive state.
- `<SlidingIndicator>` — shared-track highlighted tab/segment pill using ResizeObserver/layout transform.
- `pressable` utility classes — tactile `active:scale-[0.98]` feedback across `Button` and cards.

### Accessibility & Reduced Motion Guarantees

1. **Progressive enhancement:** `<html data-motion="ready">` is set only when JS hydrates cleanly, `IntersectionObserver` exists, and reduced motion is off. Without JS or on slow hydration, all headings, sections, and CTAs render immediately at `opacity: 1`.
2. **`prefers-reduced-motion: reduce`:** CSS kills non-essential durations globally (`0.01ms !important`), pauses `.vf-float` and `.vf-marquee-track`, disables `::view-transition` cross-slides, and React hooks short-circuit count-ups and flips immediately.
3. **No CLS (`< 0.05`):** Every reveal animates only `transform` and `opacity`; collapses sit below trigger controls or expand intentionally; marquee track uses explicit dimensions; display font uses matched fallback metrics.

---

## 6. Do & Don't Guardrails

- **Do** reuse `BrandMark` and semantic surface tokens (`bg-surface`, `bg-canvas`, `text-stone-900`, `accent-700`) so light and dark themes stay coherent.
- **Do** keep Focus tier (`/edit`, `/present`) whisper-quiet around Excalidraw.
- **Don't** animate `width`, `height`, `top`, `left`, or trigger per-frame layout reads (`getBoundingClientRect` inside `scroll` handlers).
- **Don't** add heavy JS animation libraries (`framer-motion`, `gsap`, `lottie`) or external CDN fonts (restricted by CSP).
- **Don't** invent fake metrics, fake user counts, or testimonials anywhere on marketing surfaces.
