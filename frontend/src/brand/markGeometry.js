/**
 * Canonical SVG geometry and color tokens for the Visualify brand mark.
 * Shared between BrandMark.jsx (in-app React logo) and scripts/generateBrandAssets.js
 * (favicons, app icons, and Open Graph image) so tab icons and in-app UI never drift.
 */

export const BRAND_MARK_VIEWBOX = "0 0 32 32";

export const BRAND_MARK_SHAPES = Object.freeze({
  badge: { x: 0, y: 0, width: 32, height: 32, rx: 8 },
  monoFrame: { x: 1.5, y: 1.5, width: 29, height: 29, rx: 7, strokeWidth: 2 },
  topNode: { x: 6, y: 6, width: 10, height: 8, rx: 2 },
  bottomNode: { x: 16, y: 18, width: 10, height: 8, rx: 2 },
  upperConnector: "M16 10H20A2 2 0 0 1 22 12V18",
  lowerConnector: "M10 14V20A2 2 0 0 0 12 22H16",
  connectorStrokeWidth: 2.2,
  spark: { cx: 23, cy: 9, r: 2.2 },
});

export const BRAND_MARK_PALETTES = Object.freeze({
  default: {
    bg: "var(--brand-bg, #0f766e)",
    fg: "var(--brand-fg, #ffffff)",
    spark: "var(--brand-spark, #f59e0b)",
  },
  inverse: {
    bg: "#ffffff",
    fg: "#0f766e",
    spark: "#d97706",
  },
  mono: {
    bg: "none",
    fg: "currentColor",
    spark: "currentColor",
  },
});

/**
 * Renders the canonical brand mark as a standalone SVG string for static assets.
 * @param {object} [options]
 * @param {number} [options.size=32]
 * @param {boolean} [options.darkAware=false]
 * @param {string} [options.title]
 * @param {number} [options.scale=1] Scale factor centered inside 32x32 for maskable/apple safe zones.
 * @param {string} [options.backdropColor="#0f766e"]
 */
export function renderBrandMarkSvg({
  size = 32,
  darkAware = false,
  title = "Visualify",
  scale = 1,
  backdropColor = "#0f766e",
} = {}) {
  const { badge, topNode, bottomNode, upperConnector, lowerConnector, connectorStrokeWidth, spark } =
    BRAND_MARK_SHAPES;

  const styleBlock = darkAware
    ? `<style>
    .vf-badge { fill: #0f766e; }
    .vf-fg { fill: #ffffff; }
    .vf-stroke { stroke: #ffffff; }
    .vf-spark { fill: #f59e0b; }
    @media (prefers-color-scheme: dark) {
      .vf-badge { fill: #0d9488; stroke: #2dd4bf; stroke-width: 1; }
      .vf-spark { fill: #fbbf24; }
    }
  </style>`
    : "";

  const isScaled = scale !== 1;
  const offset = ((1 - scale) * 32) / 2;
  const groupOpen = isScaled ? `<g transform="translate(${offset.toFixed(2)} ${offset.toFixed(2)}) scale(${scale})">` : "<g>";

  const badgeMarkup = isScaled
    ? `<rect width="32" height="32" fill="${backdropColor}" />`
    : darkAware
      ? `<rect class="vf-badge" x="0.5" y="0.5" width="31" height="31" rx="7.5" />`
      : `<rect x="${badge.x}" y="${badge.y}" width="${badge.width}" height="${badge.height}" rx="${badge.rx}" fill="${backdropColor}" />`;

  const fgClass = darkAware ? `class="vf-fg"` : `fill="#ffffff"`;
  const strokeClass = darkAware ? `class="vf-stroke"` : `stroke="#ffffff"`;
  const sparkClass = darkAware ? `class="vf-spark"` : `fill="#f59e0b"`;
  const titleTag = title ? `<title>${title}</title>` : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${BRAND_MARK_VIEWBOX}" width="${size}" height="${size}" role="img" aria-label="${title || "Visualify"}">
  ${titleTag}
  ${styleBlock}
  ${badgeMarkup}
  ${groupOpen}
    <rect ${fgClass} x="${topNode.x}" y="${topNode.y}" width="${topNode.width}" height="${topNode.height}" rx="${topNode.rx}" />
    <rect ${fgClass} x="${bottomNode.x}" y="${bottomNode.y}" width="${bottomNode.width}" height="${bottomNode.height}" rx="${bottomNode.rx}" />
    <path ${strokeClass} d="${upperConnector}" fill="none" stroke-width="${connectorStrokeWidth}" stroke-linecap="round" stroke-linejoin="round" />
    <path ${strokeClass} d="${lowerConnector}" fill="none" stroke-width="${connectorStrokeWidth}" stroke-linecap="round" stroke-linejoin="round" />
    <circle ${sparkClass} cx="${spark.cx}" cy="${spark.cy}" r="${spark.r}" />
  </g>
</svg>
`;
}
