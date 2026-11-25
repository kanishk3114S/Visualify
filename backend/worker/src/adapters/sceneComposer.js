import { validateExcalidrawScene } from "../schemas/excalidrawScene.js";
import { SEMANTIC_PALETTE, resolveDiagramStyle } from "./diagramTheme.js";

export const SECTION_ID_SEPARATOR = "__";
const SECTION_GAP = 160;
const TITLE_FONT_SIZE = 26;
const TITLE_GAP = 40;
const BACKDROP_PAD = 28;
const FRAME_PAD = 24;

const VISUAL_TYPE_TAG = {
  flowchart: "FLOWCHART",
  sequence: "SEQUENCE",
  mindmap: "MIND MAP",
  comparison: "COMPARISON",
  timeline: "TIMELINE",
  er_diagram: "ER DIAGRAM",
  class_diagram: "CLASS DIAGRAM",
};

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

function makeText({ id, text, x, y, width, height, fontSize, fontFamily, strokeColor, containerId = null, textAlign = "left", verticalAlign = "top" }) {
  return {
    id,
    type: "text",
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor,
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
    fontSize,
    fontFamily,
    textAlign,
    verticalAlign,
    containerId,
    originalText: text,
    autoResize: true,
    lineHeight: 1.25,
  };
}

function makePill({ id, textId, text, x, y, backgroundColor, strokeColor, textColor, fontFamily }) {
  const fontSize = 13;
  const textWidth = Math.max(24, Math.ceil(text.length * fontSize * 0.62));
  const textHeight = Math.round(fontSize * 1.25);
  const width = textWidth + 20;
  const height = textHeight + 12;
  const rect = {
    id,
    type: "rectangle",
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor,
    backgroundColor,
    fillStyle: "solid",
    strokeWidth: 1.5,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: { type: 3 },
    seed: 2,
    version: 1,
    versionNonce: 2,
    isDeleted: false,
    boundElements: [{ id: textId, type: "text" }],
    updated: 1,
    link: null,
    locked: false,
  };
  const label = makeText({
    id: textId,
    text,
    x: x + 10,
    y: y + 6,
    width: textWidth,
    height: textHeight,
    fontSize,
    fontFamily,
    strokeColor: textColor,
    containerId: id,
    textAlign: "center",
    verticalAlign: "middle",
  });
  return { rect, label, width, height };
}

function makeBackdrop({ id, x, y, width, height, strokeColor }) {
  return {
    id,
    type: "rectangle",
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor,
    backgroundColor: "#faf8f5",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "dashed",
    roughness: 0,
    opacity: 65,
    groupIds: [],
    frameId: null,
    roundness: { type: 3 },
    seed: 3,
    version: 1,
    versionNonce: 3,
    isDeleted: false,
    boundElements: [],
    updated: 1,
    link: null,
    locked: false,
  };
}

function makeFrame({ id, name, x, y, width, height }) {
  return {
    id,
    type: "frame",
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: "#bbb",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: 4,
    version: 1,
    versionNonce: 4,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    name: name ? String(name).slice(0, 120) : null,
  };
}

function buildSectionBlock(part, { index, startY, style }) {
  const core = SEMANTIC_PALETTE.core;
  const callout = SEMANTIC_PALETTE.callout;
  const prefix = sectionElementPrefix(part.sectionId);
  const source = (part.scene?.elements ?? []).filter((el) => el && !el.isDeleted);
  const b = bounds(source);
  const contentW = Math.max(120, b.maxX - b.minX);
  const contentH = Math.max(60, b.maxY - b.minY);
  const frameLabel = part.frameName ?? (part.title ? `${index + 1}. ${part.title}` : null);
  const frameId = frameLabel ? `${prefix}frame` : null;

  if (part.title) {
    const indexText = String(index + 1).padStart(2, "0");
    const badge = makePill({
      id: `${prefix}badge`,
      textId: `${prefix}badge_txt`,
      text: indexText,
      x: 0,
      y: startY + 2,
      backgroundColor: core.fill,
      strokeColor: core.stroke,
      textColor: core.ink,
      fontFamily: style.fontFamily,
    });

    const titleX = badge.width + 14;
    const titleW = Math.max(120, Math.min(1400, part.title.length * TITLE_FONT_SIZE * 0.56));
    const titleH = Math.round(TITLE_FONT_SIZE * 1.25);
    const title = makeText({
      id: `${prefix}title`,
      text: part.title,
      x: titleX,
      y: startY,
      width: titleW,
      height: titleH,
      fontSize: TITLE_FONT_SIZE,
      fontFamily: style.fontFamily,
      strokeColor: "#0f172a",
    });

    const typeLabel = part.visualType ? VISUAL_TYPE_TAG[part.visualType] ?? part.visualType.toUpperCase() : null;
    const typePill = typeLabel
      ? makePill({
          id: `${prefix}type`,
          textId: `${prefix}type_txt`,
          text: typeLabel,
          x: titleX + titleW + 14,
          y: startY + 2,
          backgroundColor: callout.fill,
          strokeColor: callout.stroke,
          textColor: callout.ink,
          fontFamily: style.fontFamily,
        })
      : null;

    const headerBottom = startY + Math.max(badge.height, titleH);
    const contentTop = headerBottom + TITLE_GAP;

    const backdrop = makeBackdrop({
      id: `${prefix}backdrop`,
      x: -BACKDROP_PAD,
      y: contentTop - BACKDROP_PAD,
      width: contentW + BACKDROP_PAD * 2,
      height: contentH + BACKDROP_PAD * 2,
      strokeColor: "#cbd5e1",
    });

    const shifted = namespaceElements(source, prefix, { dx: -b.minX, dy: contentTop - b.minY });
    const inner = [backdrop, badge.rect, badge.label, title];
    if (typePill) inner.push(typePill.rect, typePill.label);
    inner.push(...shifted);

    const innerBounds = bounds(inner);
    const frame = makeFrame({
      id: frameId,
      name: frameLabel,
      x: innerBounds.minX - FRAME_PAD,
      y: innerBounds.minY - FRAME_PAD,
      width: innerBounds.maxX - innerBounds.minX + FRAME_PAD * 2,
      height: innerBounds.maxY - innerBounds.minY + FRAME_PAD * 2,
    });
    const framedInner = inner.map((el) => ({ ...el, frameId }));
    return {
      elements: [frame, ...framedInner],
      minY: frame.y,
      maxY: frame.y + frame.height,
      nextCursorY: frame.y + frame.height + SECTION_GAP,
    };
  }

  const shifted = namespaceElements(source, prefix, { dx: -b.minX, dy: startY - b.minY });
  if (frameId) {
    const innerBounds = bounds(shifted);
    const frame = makeFrame({
      id: frameId,
      name: part.frameName.startsWith(`${index + 1}.`) ? part.frameName : `${index + 1}. ${part.frameName}`,
      x: innerBounds.minX - FRAME_PAD,
      y: innerBounds.minY - FRAME_PAD,
      width: innerBounds.maxX - innerBounds.minX + FRAME_PAD * 2,
      height: innerBounds.maxY - innerBounds.minY + FRAME_PAD * 2,
    });
    const framedShifted = shifted.map((el) => ({ ...el, frameId }));
    return {
      elements: [frame, ...framedShifted],
      minY: frame.y,
      maxY: frame.y + frame.height,
      nextCursorY: frame.y + frame.height + SECTION_GAP,
    };
  }

  return {
    elements: shifted,
    minY: startY,
    maxY: startY + contentH,
    nextCursorY: startY + contentH + SECTION_GAP,
  };
}

/**
 * Combines per-section scenes into one validated Excalidraw scene, stacking
 * sections vertically inside labeled frames so Presentation mode and selective
 * frame exports can address each slide cleanly.
 *
 * @param {Array<{ sectionId: string, title: string|null, frameName?: string|null, visualType?: string, scene: { elements: object[] } }>} parts
 * @param {{ visualStyle?: string }} [options]
 */
export function composeLessonScene(parts, { visualStyle = "hand_drawn_clean" } = {}) {
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new Error("composeLessonScene requires at least one section scene");
  }
  const style = resolveDiagramStyle(visualStyle);
  const elements = [];
  let cursorY = 0;

  for (let i = 0; i < parts.length; i++) {
    const block = buildSectionBlock(parts[i], { index: i, startY: cursorY, style });
    elements.push(...block.elements);
    cursorY = block.nextCursorY;
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

/**
 * Extracts ordered frames/slides from a scene (falls back to section prefixes
 * or whole canvas when legacy scenes contain no explicit frame elements).
 */
export function extractSceneFrames(sceneJson, learningPlan = null) {
  const elements = (sceneJson?.elements ?? []).filter((el) => el && !el.isDeleted);
  if (elements.length === 0) return [];

  const frames = elements
    .filter((el) => el.type === "frame")
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const planSections = learningPlan?.sections ?? [];
  const sectionTitleById = new Map(planSections.map((s) => [s.id, s.title]));

  if (frames.length > 0) {
    return frames.map((frame, index) => {
      const sectionId = frame.id.endsWith(`${SECTION_ID_SEPARATOR}frame`)
        ? frame.id.slice(0, -(SECTION_ID_SEPARATOR.length + "frame".length))
        : null;
      const children = elements.filter(
        (el) => el.type !== "frame" && (el.frameId === frame.id || (sectionId && el.id.startsWith(`${sectionId}${SECTION_ID_SEPARATOR}`)))
      );
      const b = children.length ? bounds(children) : { minX: frame.x, minY: frame.y, maxX: frame.x + frame.width, maxY: frame.y + frame.height };
      const title = frame.name?.trim() || (sectionId ? sectionTitleById.get(sectionId) : null) || `Slide ${index + 1}`;
      return {
        frameId: frame.id,
        sectionId,
        title,
        index,
        elementIds: [frame.id, ...children.map((c) => c.id)],
        bounds: { x: b.minX, y: b.minY, width: Math.max(1, b.maxX - b.minX), height: Math.max(1, b.maxY - b.minY) },
      };
    });
  }

  const sectionSlides = [];
  for (const s of planSections) {
    const prefix = sectionElementPrefix(s.id);
    const matches = elements.filter((el) => el.id.startsWith(prefix));
    if (matches.length === 0) continue;
    const b = bounds(matches);
    const idx = sectionSlides.length;
    sectionSlides.push({
      frameId: null,
      sectionId: s.id,
      title: `${idx + 1}. ${s.title}`,
      index: idx,
      elementIds: matches.map((el) => el.id),
      bounds: { x: b.minX, y: b.minY, width: Math.max(1, b.maxX - b.minX), height: Math.max(1, b.maxY - b.minY) },
    });
  }
  if (sectionSlides.length > 0) return sectionSlides;

  const full = bounds(elements);
  return [
    {
      frameId: null,
      sectionId: null,
      title: learningPlan?.title || "Visual Canvas",
      index: 0,
      elementIds: elements.map((el) => el.id),
      bounds: { x: full.minX, y: full.minY, width: Math.max(1, full.maxX - full.minX), height: Math.max(1, full.maxY - full.minY) },
    },
  ];
}

/**
 * Returns a standalone clean scene restricted to a single frame/slide (used by
 * single-frame exports and multi-slide ZIP rendering).
 */
export function filterSceneToFrame(sceneJson, frameOrSectionId, learningPlan = null) {
  const frames = extractSceneFrames(sceneJson, learningPlan);
  const target = frames.find((f) => f.frameId === frameOrSectionId || f.sectionId === frameOrSectionId);
  if (!target) return null;
  const keep = new Set(target.elementIds);
  const filtered = (sceneJson?.elements ?? [])
    .filter((el) => el && !el.isDeleted && keep.has(el.id) && el.type !== "frame")
    .map((el) => ({ ...el, frameId: null }));
  if (filtered.length === 0) return null;
  return {
    type: "excalidraw",
    version: 2,
    source: sceneJson?.source ?? "visualify",
    elements: filtered,
    appState: { ...(sceneJson?.appState ?? {}), viewBackgroundColor: sceneJson?.appState?.viewBackgroundColor ?? "#ffffff" },
    files: {},
  };
}

/**
 * Replaces only one section (`${sectionId}__*` / `${sectionId}__frame`) inside an
 * existing scene while preserving edits to other sections and reflowing elements below.
 */
export function replaceSectionInScene({
  sceneJson,
  sectionId,
  sectionIndex = 0,
  sectionTitle,
  visualType,
  sectionScene,
  visualStyle = "hand_drawn_clean",
}) {
  const prefix = sectionElementPrefix(sectionId);
  const frameId = `${prefix}frame`;
  const existing = (sceneJson?.elements ?? []).filter((el) => el && !el.isDeleted);
  const belongsToTarget = (el) => el.id.startsWith(prefix) || el.frameId === frameId;
  const oldTarget = existing.filter(belongsToTarget);
  const preserved = existing.filter((el) => !belongsToTarget(el));

  let startY = 0;
  let oldBottom = 0;
  if (oldTarget.length > 0) {
    const ob = bounds(oldTarget);
    startY = Math.max(0, ob.minY);
    oldBottom = ob.maxY;
  } else if (preserved.length > 0) {
    const pb = bounds(preserved);
    startY = pb.maxY + SECTION_GAP;
    oldBottom = startY;
  }

  const style = resolveDiagramStyle(visualStyle);
  const ownTitle = sectionScene?.elements?.some((el) => el.type === "text" && el.text?.trim().toLowerCase() === String(sectionTitle ?? "").trim().toLowerCase());
  const block = buildSectionBlock(
    {
      sectionId,
      title: ownTitle ? null : sectionTitle,
      frameName: sectionTitle,
      visualType,
      scene: sectionScene,
    },
    { index: sectionIndex, startY, style }
  );

  const deltaY = oldTarget.length > 0 ? block.maxY - oldBottom : 0;
  const adjustedPreserved =
    deltaY !== 0 && oldTarget.length > 0
      ? preserved.map((el) => (el.y >= oldBottom - 10 ? { ...el, y: el.y + deltaY } : el))
      : preserved;

  const combined = [...adjustedPreserved, ...block.elements];
  const nextScene = {
    type: "excalidraw",
    version: 2,
    source: sceneJson?.source ?? "visualify",
    elements: combined,
    appState: { ...(sceneJson?.appState ?? {}), viewBackgroundColor: sceneJson?.appState?.viewBackgroundColor ?? "#ffffff" },
    files: {},
  };
  const validation = validateExcalidrawScene(nextScene);
  if (!validation.valid) {
    throw new Error(`Regenerated section scene failed validation: ${validation.errors.slice(0, 5).join("; ")}`);
  }
  return nextScene;
}
