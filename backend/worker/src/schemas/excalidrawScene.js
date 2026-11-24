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

  // Second pass: verify arrow/line bindings reference existing elements
  for (let i = 0; i < scene.elements.length; i++) {
    const el = scene.elements[i];
    if (!el || typeof el !== "object") continue;
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
