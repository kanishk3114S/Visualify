import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BrandMark } from "./BrandMark.jsx";
import { BRAND_MARK_SHAPES, BRAND_MARK_VIEWBOX, renderBrandMarkSvg } from "./markGeometry.js";

describe("BrandMark identity & accessibility", () => {
  it("renders accessible non-decorative SVG with title, aria-labelledby, and canonical viewBox", () => {
    const html = renderToStaticMarkup(createElement(BrandMark, { size: 32, title: "Visualify Home" }));
    expect(html).toContain(`viewBox="${BRAND_MARK_VIEWBOX}"`);
    expect(html).toContain('role="img"');
    expect(html).toContain("aria-labelledby=");
    expect(html).toContain("<title");
    expect(html).toContain("Visualify Home");
    expect(html).toContain(BRAND_MARK_SHAPES.upperConnector);
  });

  it("hides decorative instance from assistive technology cleanly", () => {
    const html = renderToStaticMarkup(createElement(BrandMark, { decorative: true, size: 24 }));
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('role="img"');
    expect(html).not.toContain("<title");
  });

  it("supports default, mono, and inverse variants without dropping geometry", () => {
    const monoHtml = renderToStaticMarkup(createElement(BrandMark, { variant: "mono", decorative: true }));
    expect(monoHtml).toContain('fill="none"');
    expect(monoHtml).toContain("currentColor");

    const inverseHtml = renderToStaticMarkup(createElement(BrandMark, { variant: "inverse", decorative: true }));
    expect(inverseHtml).toContain('fill="#ffffff"');
    expect(inverseHtml).toContain('fill="#0f766e"');
  });

  it("generates matching dark-aware favicon SVG markup from shared geometry", () => {
    const svg = renderBrandMarkSvg({ size: 32, darkAware: true });
    expect(svg).toContain(`viewBox="${BRAND_MARK_VIEWBOX}"`);
    expect(svg).toContain("@media (prefers-color-scheme: dark)");
    expect(svg).toContain(BRAND_MARK_SHAPES.lowerConnector);
  });
});
