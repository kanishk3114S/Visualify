import { useEffect, useMemo, useRef } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { useTheme } from "../../app/ThemeContext.jsx";
import { sceneFingerprint } from "../../lib/autosave.js";

const SECTION_SEPARATOR = "__";

/**
 * Lazily loaded Excalidraw canvas (FR-EDIT-01). Hydrated once via initialData;
 * remount (change `key`) to load a different scene.
 *
 *  - theme follows the APP theme (editor UI only; export themes are chosen
 *    separately in the export dialog - PRD 13.1)
 *  - onSceneChange(elements, appState) fires only for real edits
 *  - onDirtyChange(bool): differs from the loaded scene or not
 *  - viewMode: read-only study view / version previews
 */
export default function WorkspaceCanvas({
  scene,
  focusSectionId,
  focusElementIds,
  focusNonce,
  fitNonce = 0,
  resetNonce = 0,
  onDirtyChange,
  onSceneChange,
  onSelectionChange,
  onReady,
  viewMode = false,
}) {
  const { resolvedTheme } = useTheme();
  const apiRef = useRef(null);
  const baseline = useRef(null);
  const last = useRef(null);
  const dirtyRef = useRef(false);
  const selectionKeyRef = useRef("");

  const initialData = useMemo(
    () => ({
      elements: scene?.elements ?? [],
      appState: { ...(scene?.appState ?? {}), viewBackgroundColor: scene?.appState?.viewBackgroundColor ?? "#ffffff" },
      files: {},
      scrollToContent: true,
    }),
    [scene]
  );

  function resolveFocusTargets(api) {
    const all = api.getSceneElements();
    if (focusElementIds?.length) {
      const keep = new Set(focusElementIds);
      const targets = all.filter((el) => keep.has(el.id) && el.type !== "frame");
      return targets.length ? targets : all.filter((el) => keep.has(el.id));
    }
    if (focusSectionId) {
      const prefix = `${focusSectionId}${SECTION_SEPARATOR}`;
      const targets = all.filter((el) => el.id.startsWith(prefix) && el.type !== "frame");
      return targets.length ? targets : all.filter((el) => el.id.startsWith(prefix));
    }
    return null;
  }

  useEffect(() => {
    if ((!focusSectionId && !focusElementIds?.length) || !apiRef.current) return;
    const api = apiRef.current;
    const targets = resolveFocusTargets(api);
    if (targets?.length) {
      api.scrollToContent(targets, { fitToViewport: true, viewportZoomFactor: 0.85, maxZoom: 1.5, animate: true });
      if (!viewMode && focusSectionId) {
        const selectedElementIds = Object.fromEntries(
          targets.filter((t) => !t.id.endsWith("__backdrop")).slice(0, 20).map((t) => [t.id, true])
        );
        api.updateScene({ appState: { selectedElementIds } });
        const timer = setTimeout(() => {
          apiRef.current?.updateScene({ appState: { selectedElementIds: {} } });
        }, 950);
        return () => clearTimeout(timer);
      }
    }
    return undefined;
  }, [focusSectionId, focusElementIds, focusNonce, viewMode]);

  useEffect(() => {
    if (!fitNonce || !apiRef.current) return;
    apiRef.current.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.9, minZoom: 0.2, maxZoom: 1.2, animate: true });
  }, [fitNonce]);

  useEffect(() => {
    if (!resetNonce || !apiRef.current) return;
    apiRef.current.updateScene({ appState: { scrollX: 0, scrollY: 0, zoom: { value: 1 }, selectedElementIds: {} } });
    apiRef.current.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.9, minZoom: 0.2, maxZoom: 1, animate: true });
  }, [resetNonce]);

  return (
    <div className="h-full w-full" data-testid="workspace-canvas">
      <Excalidraw
        initialData={initialData}
        theme={resolvedTheme}
        viewModeEnabled={viewMode}
        excalidrawAPI={(api) => {
          apiRef.current = api;
          onReady?.(api);
        }}
        onChange={(elements, appState) => {
          const fingerprint = sceneFingerprint(elements);
          if (baseline.current === null) {
            baseline.current = fingerprint;
            last.current = fingerprint;
            requestAnimationFrame(() => {
              const api = apiRef.current;
              if (!api) return;
              const initialTargets = resolveFocusTargets(api);
              if (initialTargets?.length) {
                api.scrollToContent(initialTargets, { fitToViewport: true, viewportZoomFactor: 0.85, maxZoom: 1.5 });
              } else {
                api.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.9, minZoom: 0.2, maxZoom: 1 });
              }
            });
            return;
          }
          if (onSelectionChange) {
            const selectedMap = appState?.selectedElementIds ?? {};
            const selectedIds = Object.keys(selectedMap).filter((id) => selectedMap[id]).sort();
            const key = selectedIds.join(",");
            if (key !== selectionKeyRef.current) {
              selectionKeyRef.current = key;
              const idSet = new Set(selectedIds);
              onSelectionChange(
                elements.filter((e) => e && !e.isDeleted && idSet.has(e.id)),
                elements
              );
            }
          }
          if (fingerprint !== last.current) {
            last.current = fingerprint;
            onSceneChange?.(elements, appState);
          }
          const dirty = fingerprint !== baseline.current;
          if (dirty !== dirtyRef.current) {
            dirtyRef.current = dirty;
            onDirtyChange?.(dirty);
          }
        }}
        UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false }, tools: { image: false } }}
      />
    </div>
  );
}
