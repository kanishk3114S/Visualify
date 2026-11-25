import { useCallback, useEffect, useReducer, useRef } from "react";
import { AUTOSAVE_DEBOUNCE_MS, autosaveReducer, hasUnsavedChanges, initialAutosaveState } from "../lib/autosave.js";

/**
 * Debounced autosave (FR-EDIT-03).
 *  - change(getPayload): schedule a save AUTOSAVE_DEBOUNCE_MS after the last edit
 *  - one save in flight at a time; edits during a save trigger one follow-up save
 *  - flush(): save now and wait (used before snapshot/restore/export/leave)
 *  - pause(): cancel the timer and wait for any in-flight save (then nothing runs
 *    until the caller resets) - used around snapshot/restore which clear the draft
 *  - reset(revision): adopt a new server revision (after load/snapshot/restore)
 *  - a 409 moves to "conflict" and stops autosaving until resolved
 *
 * @param {{ save: (payload, baseRevision) => Promise<{revision:number, savedAt:string}>, initialRevision: number, debounceMs?: number }} opts
 */
export function useAutosave({ save, initialRevision = 0, debounceMs = AUTOSAVE_DEBOUNCE_MS }) {
  const [state, dispatch] = useReducer(autosaveReducer, initialRevision, initialAutosaveState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const revisionRef = useRef(initialRevision);
  const getPayloadRef = useRef(null);
  const timerRef = useRef(null);
  const inFlightRef = useRef(null);
  const dirtyRef = useRef(false);
  const pausedRef = useRef(false);
  const saveRef = useRef(save);
  saveRef.current = save;

  const runSave = useCallback(async () => {
    clearTimeout(timerRef.current);
    timerRef.current = null;
    if (inFlightRef.current) return inFlightRef.current;
    if (stateRef.current.status === "conflict") return "conflict";
    if (!dirtyRef.current || !getPayloadRef.current) return "saved";
    dirtyRef.current = false;
    const payload = getPayloadRef.current();
    dispatch({ type: "SAVE_START" });
    const promise = (async () => {
      let outcome = "saved";
      try {
        const result = await saveRef.current(payload, revisionRef.current);
        revisionRef.current = result.revision;
        dispatch({ type: "SAVE_SUCCESS", revision: result.revision, savedAt: result.savedAt });
      } catch (err) {
        if (err?.status === 409 || err?.code === "DRAFT_CONFLICT") {
          outcome = "conflict";
          stateRef.current = { ...stateRef.current, status: "conflict" };
          dispatch({ type: "CONFLICT", error: err });
        } else {
          outcome = "error";
          dirtyRef.current = true; // keep the edits for Retry
          stateRef.current = { ...stateRef.current, status: "error" };
          dispatch({ type: "SAVE_FAILURE", error: err });
        }
      } finally {
        inFlightRef.current = null;
      }
      // Edits arrived while saving: save them too (debounced).
      if (outcome === "saved" && dirtyRef.current && !pausedRef.current) {
        timerRef.current = setTimeout(runSave, debounceMs);
      }
      return outcome;
    })();
    inFlightRef.current = promise;
    return promise;
  }, [debounceMs]);

  const change = useCallback(
    (getPayload) => {
      getPayloadRef.current = getPayload;
      dirtyRef.current = true;
      dispatch({ type: "CHANGE" });
      if (pausedRef.current || stateRef.current.status === "conflict") return;
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(runSave, debounceMs);
    },
    [debounceMs, runSave]
  );

  /** Saves anything pending now. Resolves to "saved" | "error" | "conflict". */
  const flush = useCallback(async () => {
    let outcome = "saved";
    if (inFlightRef.current) outcome = await inFlightRef.current;
    if (outcome === "saved" && dirtyRef.current) outcome = await runSave();
    if (stateRef.current.status === "conflict") return "conflict";
    return outcome;
  }, [runSave]);

  const pause = useCallback(async () => {
    pausedRef.current = true;
    clearTimeout(timerRef.current);
    timerRef.current = null;
    if (inFlightRef.current) await inFlightRef.current;
  }, []);

  /** Undo pause() without discarding pending edits (e.g. a snapshot failed). */
  const resume = useCallback(() => {
    pausedRef.current = false;
    if (dirtyRef.current && !inFlightRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(runSave, debounceMs);
    }
  }, [debounceMs, runSave]);

  const reset = useCallback((revision, savedAt = new Date().toISOString()) => {
    revisionRef.current = revision;
    dirtyRef.current = false;
    pausedRef.current = false;
    clearTimeout(timerRef.current);
    timerRef.current = null;
    dispatch({ type: "RESET", revision, savedAt });
  }, []);

  /** Retry after an error, or force-save after a conflict on top of `serverRevision`. */
  const retry = useCallback(
    (serverRevision) => {
      if (typeof serverRevision === "number") {
        revisionRef.current = serverRevision;
        dispatch({ type: "RESET", revision: serverRevision });
      }
      // Update the ref synchronously: runSave() reads it before the next render.
      stateRef.current = { ...stateRef.current, status: "pending" };
      dirtyRef.current = true;
      pausedRef.current = false;
      return runSave();
    },
    [runSave]
  );

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return {
    state,
    unsaved: hasUnsavedChanges(state),
    change,
    flush,
    pause,
    resume,
    reset,
    retry,
    isDirty: () => dirtyRef.current || Boolean(inFlightRef.current),
  };
}
