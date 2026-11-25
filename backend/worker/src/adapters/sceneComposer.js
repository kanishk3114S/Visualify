import { validateExcalidrawScene } from "../schemas/excalidrawScene.js";

export const SECTION_ID_SEPARATOR = "__";
const SECTION_GAP = 160;
const TITLE_FONT_SIZE = 28;
const TITLE_GAP = 48;

/** Prefix used for every element of a section: `${sectionId}__`. */
export function sectionElementPrefix(sectionId) {
  return `${sectionId}${SECTION_ID_SEPARATOR}`;
}

function bounds(elements) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of elements) {
    minX = Math.min(minX, el.x);
    minY = Math.min(minY, el.y);
    maxX = Math.max(maxX, el.x + (el.width || 0));
    maxY = Math.max(maxY, el.y + (el.height || 0));
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/**
 * Rewrites every element id and every reference to an id (bindings, bound
 * elements, text containers, groups, frames) with a section prefix, so that
 * several independently generated scenes can share one canvas without ID
 * collisions. Excalidraw's fractional `index` is dropped (it is regenerated
 * on load) because indices from separate scenes are not mutually ordered.
 */
export function namespaceElements(elements, prefix, { dx = 0, dy = 0 } = {}) {
  const ids = new Set(elements.map((el) => el.id));
  const map = (id) => (typeof id === "string" && ids.has(id) ? `${prefix}${id}` : id);
  const mapGroup = (gid) => `${prefix}${gid}`;

  return elements.map((el) => {
    const { index: _dropped, ...rest } = el;
    const out = { ...rest, id: map(el.id), x: el.x + dx, y: el.y + dy };
    if (Array.isArray(el.groupIds)) out.groupIds = el.groupIds.map(mapGroup);
    if (el.frameId) out.frameId = map(el.frameId);
    if (el.containerId) out.containerId = map(el.containerId);
    if (Array.isArray(el.boundElements)) {
      out.boundElements = el.boundElements.filter((b) => b && ids.has(b.id)).map((b) => ({ ...b, id: map(b.id) }));
    }
    for (const key of ["startBinding", "endBinding"]) {
      if (el[key]?.elementId) out[key] = { ...el[key], elementId: map(el[key].elementId) };
    }
    return out;
  });
}

function titleElement({ id, text, x, y }) {
  const width = Math.max(120, Math.min(1600, text.length * TITLE_FONT_SIZE * 0.55));
  return {
    id,
    type: "text",
    x,
    y,
    width,
    height: Math.round(TITLE_FONT_SIZE * 1.25),
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    text,
    fontSize: TITLE_FONT_SIZE,
    fontFamily: 5,
    textAlign: "left",
    verticalAlign: "top",
    containerId: null,
    originalText: text,
    autoResize: true,
    lineHeight: 1.25,
  };
}

/**
 * Combines per-section scenes into one validated Excalidraw scene, stacking
 * sections vertically under a title. Every element id of section S starts
 * with `${S.id}__`, which the frontend uses to scroll to a section.
 *
 * @param {Array<{ sectionId: string, title: string|null, scene: { elements: object[] } }>} parts
 * @returns {{ type: string, version: number, source: string, elements: object[], appState: object, files: object }}
 */
export function composeLessonScene(parts) {
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new Error("composeLessonScene requires at least one section scene");
  }
  const elements = [];
  let cursorY = 0;

  for (const part of parts) {
    const prefix = sectionElementPrefix(part.sectionId);
    const source = (part.scene?.elements ?? []).filter((el) => el && !el.isDeleted);
    const b = bounds(source);
    // A falsy title means the diagram already shows its own heading.
    const title = part.title ? titleElement({ id: `${prefix}title`, text: part.title, x: 0, y: cursorY }) : null;
    const contentTop = title ? cursorY + title.height + TITLE_GAP : cursorY;
    const shifted = namespaceElements(source, prefix, { dx: -b.minX, dy: contentTop - b.minY });
    if (title) elements.push(title);
    elements.push(...shifted);
    cursorY = contentTop + (b.maxY - b.minY) + SECTION_GAP;
  }

  const scene = {
    type: "excalidraw",
    version: 2,
    source: "visualify",
    elements,
    appState: { viewBackgroundColor: "#ffffff", gridSize: null },
    files: {},
  };
  const validation = validateExcalidrawScene(scene);
  if (!validation.valid) {
    throw new Error(`Composed lesson scene failed validation: ${validation.errors.slice(0, 5).join("; ")}`);
  }
  return scene;
}
