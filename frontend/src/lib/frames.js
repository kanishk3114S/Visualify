/**
 * Multi-frame slide helpers and compact selection-context extraction for the
 * frontend workspace, Presentation mode, and Explain Selection companion.
 */

const SECTION_SEPARATOR = "__";

function computeBounds(elements) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of elements) {
    if (!el || el.isDeleted) continue;
    minX = Math.min(minX, el.x ?? 0);
    minY = Math.min(minY, el.y ?? 0);
    maxX = Math.max(maxX, (el.x ?? 0) + (el.width ?? 0));
    maxY = Math.max(maxY, (el.y ?? 0) + (el.height ?? 0));
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 100, height: 100 };
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

/**
 * Extracts ordered slides/frames from an Excalidraw scene, falling back
 * gracefully to `${sectionId}__` prefixes for legacy Phase 2-4 scenes.
 */
export function extractSceneFrames(sceneJson, learningPlan = null) {
  const elements = (sceneJson?.elements ?? []).filter((el) => el && !el.isDeleted);
  if (elements.length === 0) return [];

  const frames = elements
    .filter((el) => el.type === "frame")
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const sectionById = new Map((learningPlan?.sections ?? []).map((s) => [s.id, s]));

  if (frames.length > 0) {
    return frames.map((frame, index) => {
      const sectionId = frame.id?.endsWith(`${SECTION_SEPARATOR}frame`)
        ? frame.id.slice(0, -(SECTION_SEPARATOR.length + "frame".length))
        : null;
      const children = elements.filter(
        (el) => el.type !== "frame" && (el.frameId === frame.id || (sectionId && el.id?.startsWith(`${sectionId}${SECTION_SEPARATOR}`)))
      );
      const section = sectionId ? sectionById.get(sectionId) : null;
      return {
        frameId: frame.id,
        sectionId,
        title: frame.name?.trim() || section?.title || `Slide ${index + 1}`,
        index,
        elementIds: [frame.id, ...children.map((c) => c.id)],
        bounds: children.length ? computeBounds(children) : { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
      };
    });
  }

  const sectionSlides = [];
  for (const s of learningPlan?.sections ?? []) {
    const prefix = `${s.id}${SECTION_SEPARATOR}`;
    const matches = elements.filter((el) => el.id?.startsWith(prefix));
    if (matches.length === 0) continue;
    const idx = sectionSlides.length;
    sectionSlides.push({
      frameId: null,
      sectionId: s.id,
      title: `${idx + 1}. ${s.title}`,
      index: idx,
      elementIds: matches.map((m) => m.id),
      bounds: computeBounds(matches),
    });
  }
  if (sectionSlides.length > 0) return sectionSlides;

  return [
    {
      frameId: null,
      sectionId: null,
      title: learningPlan?.title || "Visual Canvas",
      index: 0,
      elementIds: elements.map((e) => e.id),
      bounds: computeBounds(elements),
    },
  ];
}

/**
 * Picks up to 25 selected elements with minimal properties needed by
 * POST /api/v1/notes/:noteId/explain (avoids shipping the full scene).
 */
export function buildSelectedContext(selectedElements = [], allElements = []) {
  const byId = new Map((allElements ?? []).filter((e) => e && !e.isDeleted).map((e) => [e.id, e]));
  return (selectedElements ?? [])
    .filter((el) => el && !el.isDeleted && el.type !== "frame")
    .slice(0, 25)
    .map((el) => {
      const boundTexts = (el.boundElements ?? [])
        .filter((b) => b?.type === "text")
        .map((b) => byId.get(b.id)?.text)
        .filter(Boolean);
      const text = [el.text, ...boundTexts].filter(Boolean).join(" · ").trim().slice(0, 240);
      return {
        id: String(el.id),
        type: el.type,
        ...(text ? { text } : {}),
        ...(Array.isArray(el.boundElements) && el.boundElements.length ? { boundElements: el.boundElements.slice(0, 8) } : {}),
        ...(el.startBinding?.elementId ? { startBinding: { elementId: el.startBinding.elementId } } : {}),
        ...(el.endBinding?.elementId ? { endBinding: { elementId: el.endBinding.elementId } } : {}),
      };
    });
}

export function summarizeFlashcards(cards = []) {
  const total = cards.length;
  const known = cards.filter((c) => c.mastery === "known").length;
  const review = cards.filter((c) => c.mastery === "review").length;
  return { total, known, review, fresh: Math.max(0, total - known - review) };
}
