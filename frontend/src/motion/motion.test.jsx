import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Reveal } from "./Reveal.jsx";
import { Collapse } from "./Collapse.jsx";
import { Float } from "./Float.jsx";
import { queryPrefersReducedMotion } from "./useReducedMotion.js";
import { computeCountUpStep } from "./useCountUp.js";

describe("Visualify motion primitives", () => {
  it("keeps Reveal content visible without JS motion-ready flag or IntersectionObserver", () => {
    const html = renderToStaticMarkup(
      createElement(Reveal, { as: "section", delay: 120 }, createElement("h2", null, "Visible Content"))
    );
    expect(html).toContain("Visible Content");
    expect(html).toContain("vf-reveal");
    expect(html).toContain("is-visible");
    expect(html).not.toContain('opacity:0');
  });

  it("handles reduced-motion detection safely with or without matchMedia", () => {
    expect(queryPrefersReducedMotion()).toBe(false);
    expect(queryPrefersReducedMotion({ matches: true })).toBe(true);
    expect(queryPrefersReducedMotion(() => ({ matches: true }))).toBe(true);
    expect(queryPrefersReducedMotion(() => ({ matches: false }))).toBe(false);
  });

  it("returns target immediately from useCountUp math when prefers-reduced-motion is active", () => {
    expect(computeCountUpStep({ target: 42, progress: 0.1, reducedMotion: true })).toBe(42);
    expect(computeCountUpStep({ target: 42, progress: 0, reducedMotion: false })).toBe(0);
    expect(computeCountUpStep({ target: 42, progress: 1, reducedMotion: false })).toBe(42);
    const mid = computeCountUpStep({ target: 100, progress: 0.5, reducedMotion: false });
    expect(mid).toBeGreaterThan(50);
    expect(mid).toBeLessThan(100);
  });

  it("renders Collapse with synchronized open/closed attributes and Float compositor class", () => {
    const closedHtml = renderToStaticMarkup(createElement(Collapse, { open: false }, "Secret panel"));
    expect(closedHtml).toContain('data-open="false"');
    expect(closedHtml).toContain('aria-hidden="true"');

    const openHtml = renderToStaticMarkup(createElement(Collapse, { open: true }, "Shown panel"));
    expect(openHtml).toContain('data-open="true"');
    expect(openHtml).toContain('aria-hidden="false"');

    const floatHtml = renderToStaticMarkup(createElement(Float, { delay: 300 }, "Card"));
    expect(floatHtml).toContain("vf-float");
    expect(floatHtml).toContain("--float-delay:300ms");
  });
});
