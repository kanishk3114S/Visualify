import { useId } from "react";
import { BRAND_MARK_PALETTES, BRAND_MARK_SHAPES, BRAND_MARK_VIEWBOX } from "./markGeometry.js";

/**
 * Single source of truth Visualify brand mark SVG.
 * Adapts automatically to light/dark themes via CSS custom properties, and matches favicon.svg.
 *
 * @param {object} props
 * @param {number} [props.size=28] Width and height in CSS pixels.
 * @param {string} [props.title="Visualify"] Accessible title when not decorative.
 * @param {boolean} [props.decorative=false] Hide from assistive tech when adjacent text carries the label.
 * @param {"default"|"mono"|"inverse"} [props.variant="default"] Visual color treatment.
 * @param {string} [props.className]
 */
export function BrandMark({
  size = 28,
  title = "Visualify",
  decorative = false,
  variant = "default",
  className = "",
}) {
  const titleId = useId();
  const palette = BRAND_MARK_PALETTES[variant] || BRAND_MARK_PALETTES.default;
  const { badge, monoFrame, topNode, bottomNode, upperConnector, lowerConnector, connectorStrokeWidth, spark } =
    BRAND_MARK_SHAPES;

  const accessibilityProps = decorative
    ? { "aria-hidden": true }
    : {
        role: "img",
        "aria-labelledby": titleId,
      };

  return (
    <svg
      viewBox={BRAND_MARK_VIEWBOX}
      width={size}
      height={size}
      className={`shrink-0 select-none ${className}`.trim()}
      {...accessibilityProps}
    >
      {!decorative && title ? <title id={titleId}>{title}</title> : null}
      {variant === "mono" ? (
        <rect
          x={monoFrame.x}
          y={monoFrame.y}
          width={monoFrame.width}
          height={monoFrame.height}
          rx={monoFrame.rx}
          fill="none"
          stroke={palette.fg}
          strokeWidth={monoFrame.strokeWidth}
        />
      ) : (
        <rect
          x={badge.x}
          y={badge.y}
          width={badge.width}
          height={badge.height}
          rx={badge.rx}
          fill={palette.bg}
        />
      )}
      <rect
        x={topNode.x}
        y={topNode.y}
        width={topNode.width}
        height={topNode.height}
        rx={topNode.rx}
        fill={palette.fg}
      />
      <rect
        x={bottomNode.x}
        y={bottomNode.y}
        width={bottomNode.width}
        height={bottomNode.height}
        rx={bottomNode.rx}
        fill={palette.fg}
      />
      <path
        d={upperConnector}
        fill="none"
        stroke={palette.fg}
        strokeWidth={connectorStrokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={lowerConnector}
        fill="none"
        stroke={palette.fg}
        strokeWidth={connectorStrokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={spark.cx}
        cy={spark.cy}
        r={spark.r}
        fill={palette.spark}
        opacity={variant === "mono" ? 0.78 : 1}
      />
    </svg>
  );
}
