/**
 * Autosave state machine (pure, unit-tested). The hook (useAutosave) owns the
 * timers and network; this reducer owns what the UI shows.
 *
 * status:
 *   saved     everything confirmed by the server
 *   pending   local changes waiting for the debounce
 *   saving    a save is in flight
 *   error     last save failed (Retry available)
 *   conflict  the server copy changed elsewhere (409)
 */
export const AUTOSAVE_DEBOUNCE_MS = 1500;

export function initialAutosaveState(revision = 0) {
  return { status: "saved", revision, savedAt: null, error: null, changedWhileSaving: false };
}

export function autosaveReducer(state, event) {
  switch (event.type) {
    case "CHANGE":
      if (state.status === "conflict") return state; // never auto-overwrite a conflict
      if (state.status === "saving") return { ...state, changedWhileSaving: true };
      return { ...state, status: "pending", error: null };
    case "SAVE_START":
      return { ...state, status: "saving", changedWhileSaving: false, error: null };
    case "SAVE_SUCCESS":
      return {
        ...state,
        status: state.changedWhileSaving ? "pending" : "saved",
        revision: event.revision,
        savedAt: event.savedAt,
        error: null,
        changedWhileSaving: false,
      };
    case "SAVE_FAILURE":
      return { ...state, status: "error", error: event.error, changedWhileSaving: false };
    case "CONFLICT":
      return { ...state, status: "conflict", error: event.error ?? null, changedWhileSaving: false };
    case "RESET":
      return { ...initialAutosaveState(event.revision ?? 0), savedAt: event.savedAt ?? state.savedAt };
    default:
      return state;
  }
}

/** True while there is anything the server doesn't have yet. */
export const hasUnsavedChanges = (state) => ["pending", "saving", "error", "conflict"].includes(state.status);

/** Cheap change detector for Excalidraw element arrays (ids + versions + deletion). */
export function sceneFingerprint(elements) {
  let h = elements.length;
  for (const el of elements) {
    h = (h * 31 + el.version + (el.isDeleted ? 7 : 0)) % 2147483647;
    for (let i = 0; i < el.id.length; i += 1) h = (h * 33 + el.id.charCodeAt(i)) % 2147483647;
  }
  return h;
}

/** Converts live Excalidraw state into the payload the API stores. */
export function toScenePayload(elements, appState) {
  return {
    type: "excalidraw",
    version: 2,
    elements: elements.filter((el) => !el.isDeleted),
    appState: { viewBackgroundColor: appState?.viewBackgroundColor ?? "#ffffff", gridSize: appState?.gridSize ?? null },
    files: {},
  };
}

export function statusLabel(state, now = Date.now()) {
  switch (state.status) {
    case "pending":
      return "Unsaved changes";
    case "saving":
      return "Saving…";
    case "error":
      return "Save failed";
    case "conflict":
      return "Changed elsewhere";
    default: {
      if (!state.savedAt) return "All changes saved";
      const s = Math.max(0, Math.round((now - new Date(state.savedAt).getTime()) / 1000));
      return s < 10 ? "Saved just now" : "Saved";
    }
  }
}
