import { useEffect, useMemo, useRef } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";

const SECTION_SEPARATOR = "__";

/**
 * Lazily loaded Excalidraw canvas (FR-EDIT-01). Hydrated once via
 * initialData; edits stay in this editor instance (saving arrives in Phase 3).
 *
 * Props:
 *  - scene: validated scene JSON from the API
 *  - focusSectionId: scrolls to that section's elements when it changes
 *  - onDirtyChange(boolean): true once the user has edited the scene
 */
export default function WorkspaceCanvas({ scene, focusSectionId, focusNonce, onDirtyChange, onReady }) {
  const apiRef = useRef(null);
  const baseline = useRef(null);
  const dirtyRef = useRef(false);

  const initialData = useMemo(
    () => ({
      elements: scene.elements,
      appState: { ...(scene.appState ?? {}), viewBackgroundColor: scene.appState?.viewBackgroundColor ?? "#ffffff" },
      files: scene.files ?? {},
      scrollToContent: true,
    }),
    [scene]
  );

  useEffect(() => {
    if (!focusSectionId || !apiRef.current) return;
    const prefix = `${focusSectionId}${SECTION_SEPARATOR}`;
    const targets = apiRef.current.getSceneElements().filter((el) => el.id.startsWith(prefix));
    if (targets.length) {
      apiRef.current.scrollToContent(targets, { fitToViewport: true, viewportZoomFactor: 0.85, maxZoom: 1.5, animate: true });
    }
  }, [focusSectionId, focusNonce]);

  return (
    <div className="h-full w-full" data-testid="workspace-canvas">
      <Excalidraw
        initialData={initialData}
        excalidrawAPI={(api) => {
          apiRef.current = api;
          onReady?.(api);
        }}
        onChange={(elements) => {
          // A cheap fingerprint of element versions detects real edits.
          const fingerprint = elements.reduce((sum, el) => sum + el.version + (el.isDeleted ? 1 : 0), elements.length);
          if (baseline.current === null) {
            baseline.current = fingerprint;
            // First render of the hydrated scene: fit the whole lesson in view
            // (initialData.scrollToContent only centres, it doesn't zoom).
            requestAnimationFrame(() =>
              apiRef.current?.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.9, minZoom: 0.2, maxZoom: 1 })
            );
            return;
          }
          const dirty = fingerprint !== baseline.current;
          if (dirty !== dirtyRef.current) {
            dirtyRef.current = dirty;
            onDirtyChange?.(dirty);
          }
        }}
        // "Open" would replace the generated scene; file save is replaced by the library in Phase 3.
        // Native client-side image export stays available (it genuinely works).
        UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false } }}
      />
    </div>
  );
}
