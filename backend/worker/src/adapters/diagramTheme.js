/**
 * Centralized semantic palette and visual style presets for Visualify's
 * Excalidraw diagrams. Colors are high-contrast and color-blind-conscious:
 * filled shapes always pair with dark ink (#0f172a) so labels stay legible
 * in both Light and Dark Excalidraw modes.
 */

export const VISUAL_STYLES = Object.freeze(["hand_drawn_clean", "editorial_color", "minimal"]);

export const SEMANTIC_PALETTE = Object.freeze({
  core: Object.freeze({ stroke: "#0f766e", fill: "#ccfbf1", childFill: "#f0fdfa", ink: "#0f172a" }),
  branch_a: Object.freeze({ stroke: "#3730a3", fill: "#e0e7ff", childFill: "#eef2ff", ink: "#0f172a" }),
  branch_b: Object.freeze({ stroke: "#b45309", fill: "#fef3c7", childFill: "#fffbeb", ink: "#0f172a" }),
  branch_c: Object.freeze({ stroke: "#be123c", fill: "#ffe4e6", childFill: "#fff1f2", ink: "#0f172a" }),
  branch_d: Object.freeze({ stroke: "#047857", fill: "#d1fae5", childFill: "#ecfdf5", ink: "#0f172a" }),
  callout: Object.freeze({ stroke: "#334155", fill: "#f1f5f9", childFill: "#f8fafc", ink: "#0f172a" }),
});

export const BRANCH_ROLES = Object.freeze([
  SEMANTIC_PALETTE.branch_a,
  SEMANTIC_PALETTE.branch_b,
  SEMANTIC_PALETTE.branch_d,
  SEMANTIC_PALETTE.branch_c,
]);

export function resolveDiagramStyle(visualStyle = "hand_drawn_clean") {
  switch (visualStyle) {
    case "editorial_color":
      return {
        key: "editorial_color",
        fillStyle: "solid",
        headerFillStyle: "solid",
        roughness: 0,
        fontFamily: 5,
        strokeWidth: 2,
        muted: false,
      };
    case "minimal":
      return {
        key: "minimal",
        fillStyle: "solid",
        headerFillStyle: "solid",
        roughness: 0,
        fontFamily: 5,
        strokeWidth: 1.5,
        muted: true,
      };
    case "hand_drawn_clean":
    default:
      return {
        key: "hand_drawn_clean",
        fillStyle: "hachure",
        headerFillStyle: "solid",
        roughness: 1,
        fontFamily: 1,
        strokeWidth: 2,
        muted: false,
      };
  }
}

export function rolePaletteFor(role, style) {
  const base = SEMANTIC_PALETTE[role] ?? SEMANTIC_PALETTE.branch_a;
  if (!style?.muted) return base;
  return {
    stroke: base.stroke,
    fill: role === "core" ? "#f0fdfa" : "#ffffff",
    childFill: "#f8fafc",
    ink: "#0f172a",
  };
}

const MONOCHROME_BG = new Set(["", "transparent", "#ffffff", "#fff", "#ececff", "#f8fafc", "#f4f4f4", "#ffffde"]);
const MONOCHROME_STROKE = new Set(["", "#000000", "#000", "#1e1e1e", "#333333", "#333", "#9370db", "#aaaa33"]);

/**
 * Post-processes Excalidraw scenes converted from Mermaid by @excalidraw/cli
 * so monochrome defaults gain Visualify's semantic palette, roundness, and
 * visualStyle consistency without disturbing element geometry or bindings.
 */
export function styleConvertedScene(scene, { visualStyle = "hand_drawn_clean", kind = "flowchart" } = {}) {
  if (!scene || !Array.isArray(scene.elements)) return scene;
  const style = resolveDiagramStyle(visualStyle);
  const byId = new Map(scene.elements.map((el) => [el.id, el]));
  const shapeRoleMap = new Map();
  let shapeIndex = 0;

  const pickRole = (el) => {
    if (el.type === "diamond") return SEMANTIC_PALETTE.branch_b;
    if (el.type === "ellipse") return SEMANTIC_PALETTE.core;
    if (kind === "sequence" && el.y < 140) {
      return shapeIndex % 2 === 0 ? SEMANTIC_PALETTE.core : SEMANTIC_PALETTE.branch_a;
    }
    if (shapeIndex === 0) return SEMANTIC_PALETTE.core;
    return BRANCH_ROLES[(shapeIndex - 1) % BRANCH_ROLES.length];
  };

  const elements = scene.elements.map((raw) => {
    if (!raw || raw.isDeleted) return raw;
    const el = { ...raw };

    if (el.type === "rectangle" || el.type === "diamond" || el.type === "ellipse") {
      const bg = String(el.backgroundColor ?? "").toLowerCase();
      const stroke = String(el.strokeColor ?? "").toLowerCase();
      const isDefaultShape = MONOCHROME_BG.has(bg) || MONOCHROME_STROKE.has(stroke);
      const role = pickRole(el);
      const pal = rolePaletteFor(
        role === SEMANTIC_PALETTE.core
          ? "core"
          : role === SEMANTIC_PALETTE.branch_b
            ? "branch_b"
            : role === SEMANTIC_PALETTE.branch_c
              ? "branch_c"
              : role === SEMANTIC_PALETTE.branch_d
                ? "branch_d"
                : "branch_a",
        style
      );
      shapeRoleMap.set(el.id, pal);
      shapeIndex += 1;

      if (isDefaultShape) {
        el.strokeColor = pal.stroke;
        el.backgroundColor = style.muted ? pal.childFill : pal.fill;
      } else if (style.muted) {
        el.backgroundColor = "#ffffff";
      }

      el.fillStyle = style.fillStyle;
      el.roughness = style.roughness;
      el.strokeWidth = el.strokeWidth && el.strokeWidth > 2 ? el.strokeWidth : style.strokeWidth;
      if (el.type === "rectangle" && !el.roundness) {
        el.roundness = { type: 3 };
      }
      return el;
    }

    if (el.type === "arrow" || el.type === "line") {
      el.roughness = style.roughness;
      const stroke = String(el.strokeColor ?? "").toLowerCase();
      if (!stroke || MONOCHROME_STROKE.has(stroke)) {
        el.strokeColor = "#334155";
      }
      return el;
    }

    if (el.type === "text") {
      el.fontFamily = style.fontFamily;
      el.lineHeight = el.lineHeight ?? 1.25;
      const container = el.containerId ? byId.get(el.containerId) : null;
      if (container && (container.type === "rectangle" || container.type === "diamond" || container.type === "ellipse")) {
        el.strokeColor = "#0f172a";
      } else {
        const stroke = String(el.strokeColor ?? "").toLowerCase();
        if (!stroke || MONOCHROME_STROKE.has(stroke)) {
          el.strokeColor = "#1e293b";
        }
      }
      return el;
    }

    return el;
  });

  return {
    ...scene,
    appState: {
      ...(scene.appState ?? {}),
      viewBackgroundColor: scene.appState?.viewBackgroundColor ?? "#ffffff",
    },
    elements,
  };
}
