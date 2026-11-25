const ALLOWED_ELEMENT_TYPES = new Set([
  "rectangle",
  "diamond",
  "ellipse",
  "arrow",
  "line",
  "text",
  "frame",
]);

const MAX_ELEMENTS = 500;
const MAX_COORD = 20_000;
const MAX_DIMENSION = 10_000;
const MAX_TEXT_LENGTH = 2_000;

/**
 * Validates that an Excalidraw scene JSON object is structurally sound, bounded,
 * has unique IDs, valid arrow bindings, and can safely hydrate @excalidraw/excalidraw.
 */
export function validateExcalidrawScene(scene) {
  const errors = [];

  if (!scene || typeof scene !== "object" || Array.isArray(scene)) {
    return { valid: false, errors: ["Scene must be a plain object"] };
  }

  if (!Array.isArray(scene.elements)) {
    return { valid: false, errors: ["Scene must include an elements array"] };
  }

  if (scene.elements.length === 0) {
    errors.push("Scene must contain at least 1 element");
  }
  if (scene.elements.length > MAX_ELEMENTS) {
    errors.push(`Scene exceeds max element limit (${scene.elements.length} > ${MAX_ELEMENTS})`);
  }

  const elementIds = new Set();
  for (let i = 0; i < scene.elements.length; i++) {
    const el = scene.elements[i];
    if (!el || typeof el !== "object") {
      errors.push(`elements[${i}] must be an object`);
      continue;
    }

    if (typeof el.id !== "string" || !el.id.trim()) {
      errors.push(`elements[${i}] missing non-empty id`);
    } else if (elementIds.has(el.id)) {
      errors.push(`Duplicate element id: ${el.id}`);
    } else {
      elementIds.add(el.id);
    }

    if (!ALLOWED_ELEMENT_TYPES.has(el.type)) {
      errors.push(`elements[${i}] has unsupported type: ${String(el.type)}`);
    }

    for (const numField of ["x", "y", "width", "height"]) {
      if (typeof el[numField] !== "number" || !Number.isFinite(el[numField])) {
        errors.push(`elements[${i}].${numField} must be a finite number`);
      }
    }

    if (typeof el.x === "number" && Math.abs(el.x) > MAX_COORD) {
      errors.push(`elements[${i}].x out of canvas bounds (${el.x})`);
    }
    if (typeof el.y === "number" && Math.abs(el.y) > MAX_COORD) {
      errors.push(`elements[${i}].y out of canvas bounds (${el.y})`);
    }
    if (typeof el.width === "number" && (el.width < 0 || el.width > MAX_DIMENSION)) {
      errors.push(`elements[${i}].width out of bounds (${el.width})`);
    }
    if (typeof el.height === "number" && (el.height < 0 || el.height > MAX_DIMENSION)) {
      errors.push(`elements[${i}].height out of bounds (${el.height})`);
    }

    if (el.type === "text") {
      if (typeof el.text !== "string") {
        errors.push(`Text element ${el.id || i} missing text string`);
      } else if (el.text.length > MAX_TEXT_LENGTH) {
        errors.push(`Text element ${el.id || i} exceeds max text length`);
      }
    }

    if (el.type === "arrow" || el.type === "line") {
      if (!Array.isArray(el.points) || el.points.length < 2) {
        errors.push(`${el.type} element ${el.id || i} must have at least 2 points`);
      }
    }
  }

  const frameIds = new Set(scene.elements.filter((el) => el && el.type === "frame" && typeof el.id === "string").map((el) => el.id));

  // Second pass: verify arrow/line bindings and frameId references
  for (let i = 0; i < scene.elements.length; i++) {
    const el = scene.elements[i];
    if (!el || typeof el !== "object") continue;
    if (el.type === "frame" && el.name !== undefined && el.name !== null && (typeof el.name !== "string" || el.name.length > 200)) {
      errors.push(`elements[${i}].name must be a short string on frame elements`);
    }
    if (el.frameId && !frameIds.has(el.frameId)) {
      errors.push(`elements[${i}].frameId references missing frame ${el.frameId}`);
    }
    for (const bindingKey of ["startBinding", "endBinding"]) {
      const binding = el[bindingKey];
      if (binding && binding.elementId && !elementIds.has(binding.elementId)) {
        errors.push(
          `elements[${i}].${bindingKey} references missing element ${binding.elementId}`
        );
      }
    }
  }

  if (scene.appState !== undefined && (typeof scene.appState !== "object" || scene.appState === null)) {
    errors.push("scene.appState must be an object when provided");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ---------------------------------------------------------------------------
// User-edited scenes (Phase 3 autosave / snapshots / exports)
// ---------------------------------------------------------------------------
const EDITABLE_ELEMENT_TYPES = new Set([...ALLOWED_ELEMENT_TYPES, "freedraw"]);
const MAX_EDITABLE_ELEMENTS = 3000;
const MAX_POINTS_PER_ELEMENT = 5000;
const SAFE_APP_STATE_KEYS = ["viewBackgroundColor", "gridSize", "gridStep", "gridModeEnabled"];
const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;

function isSafeLink(link) {
  if (link === null || link === undefined || link === "") return true;
  if (typeof link !== "string" || link.length > 2000) return false;
  try {
    const url = new URL(link);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Validates a scene coming back from the editor:
 *  - only drawable vector types (no image/embeddable/iframe: no external or
 *    binary content is stored or rendered server-side)
 *  - links must be http(s) (blocks javascript:/data: URLs)
 *  - bounded element and point counts, coordinates, sizes, colours and text
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateEditableScene(scene) {
  if (!scene || typeof scene !== "object" || Array.isArray(scene) || !Array.isArray(scene.elements)) {
    return { valid: false, errors: ["Scene must be an object with an elements array"] };
  }
  const errors = [];
  if (scene.elements.length > MAX_EDITABLE_ELEMENTS) {
    errors.push(`Scene exceeds max element limit (${scene.elements.length} > ${MAX_EDITABLE_ELEMENTS})`);
  }
  if (scene.files && typeof scene.files === "object" && Object.keys(scene.files).length > 0) {
    errors.push("Embedded files (images) are not supported");
  }
  const ids = new Set();
  for (let i = 0; i < scene.elements.length && errors.length < 20; i++) {
    const el = scene.elements[i];
    if (!el || typeof el !== "object") {
      errors.push(`elements[${i}] must be an object`);
      continue;
    }
    if (typeof el.id !== "string" || !el.id.trim() || el.id.length > 200) errors.push(`elements[${i}] has an invalid id`);
    else if (ids.has(el.id)) errors.push(`Duplicate element id: ${el.id}`);
    else ids.add(el.id);
    if (!EDITABLE_ELEMENT_TYPES.has(el.type)) errors.push(`elements[${i}] has unsupported type: ${String(el.type)}`);
    for (const f of ["x", "y", "width", "height"]) {
      if (typeof el[f] !== "number" || !Number.isFinite(el[f])) errors.push(`elements[${i}].${f} must be a finite number`);
    }
    if (Math.abs(el.x) > MAX_COORD * 5 || Math.abs(el.y) > MAX_COORD * 5) errors.push(`elements[${i}] is out of canvas bounds`);
    if (el.width < 0 || el.width > MAX_DIMENSION * 2 || el.height < 0 || el.height > MAX_DIMENSION * 2) {
      errors.push(`elements[${i}] has out-of-bounds dimensions`);
    }
    if (el.type === "text" && (typeof el.text !== "string" || el.text.length > MAX_TEXT_LENGTH * 5)) {
      errors.push(`Text element ${i} has invalid text`);
    }
    if (["arrow", "line", "freedraw"].includes(el.type)) {
      if (!Array.isArray(el.points) || el.points.length < 1 || el.points.length > MAX_POINTS_PER_ELEMENT) {
        errors.push(`${el.type} element ${i} has an invalid points array`);
      }
    }
    if (el.type === "frame" && el.name !== undefined && el.name !== null && (typeof el.name !== "string" || el.name.length > 200)) {
      errors.push(`Frame element ${i} has invalid name`);
    }
    if (el.frameId !== undefined && el.frameId !== null && (typeof el.frameId !== "string" || el.frameId.length > 200)) {
      errors.push(`elements[${i}] has invalid frameId`);
    }
    if (!isSafeLink(el.link)) errors.push(`elements[${i}] has an unsafe link`);
    for (const c of ["strokeColor", "backgroundColor"]) {
      if (el[c] !== undefined && el[c] !== "transparent" && !(typeof el[c] === "string" && HEX_COLOR.test(el[c]))) {
        errors.push(`elements[${i}].${c} must be a hex color or transparent`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Storage-safe copy: drops deleted elements, keeps only an allowlist of
 * appState keys (no selections, collaborators or other editor UI state) and
 * never keeps files. Call AFTER validateEditableScene().
 */
export function sanitizeEditableScene(scene) {
  const appState = {};
  for (const key of SAFE_APP_STATE_KEYS) {
    if (scene.appState && scene.appState[key] !== undefined) appState[key] = scene.appState[key];
  }
  if (typeof appState.viewBackgroundColor !== "string" || !HEX_COLOR.test(appState.viewBackgroundColor)) {
    appState.viewBackgroundColor = "#ffffff";
  }
  const active = scene.elements.filter((el) => el && !el.isDeleted);
  const frameIds = new Set(active.filter((el) => el.type === "frame").map((el) => el.id));
  const elements = active.map((el) => (el.frameId && !frameIds.has(el.frameId) ? { ...el, frameId: null } : el));
  return {
    type: "excalidraw",
    version: 2,
    source: "visualify",
    elements,
    appState,
    files: {},
  };
}
