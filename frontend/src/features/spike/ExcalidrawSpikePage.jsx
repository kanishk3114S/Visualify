import { useEffect, useState } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { SAMPLE_SCENE } from "./sampleScene.js";

/**
 * Phase 0 Excalidraw editor harness, preserved unchanged at /spike/excalidraw.
 * Lazily loaded so the editor bundle and its CSS never load on other routes.
 */
export default function ExcalidrawSpikePage() {
  const [sceneKey, setSceneKey] = useState(0);
  const [activeScene, setActiveScene] = useState(SAMPLE_SCENE);
  const [elementCount, setElementCount] = useState(SAMPLE_SCENE.elements.length);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    // Expose a spike verification hook so automated Playwright tests can load
    // externally generated .excalidraw JSON payloads via initialData.
    window.__VISUALIFY_LOAD_SCENE__ = (scenePayload) => {
      if (!scenePayload || !Array.isArray(scenePayload.elements)) {
        setLoadError("Invalid scene payload: missing elements array");
        return false;
      }
      setLoadError(null);
      setActiveScene({
        elements: scenePayload.elements,
        appState: scenePayload.appState || { viewBackgroundColor: "#ffffff" },
        files: scenePayload.files || {},
      });
      setElementCount(scenePayload.elements.length);
      setSceneKey((prev) => prev + 1);
      return true;
    };

    return () => {
      delete window.__VISUALIFY_LOAD_SCENE__;
    };
  }, []);

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const rawText = await file.text();
      const parsed = JSON.parse(rawText);
      window.__VISUALIFY_LOAD_SCENE__(parsed);
    } catch (err) {
      setLoadError(`Failed to parse scene JSON: ${err.message}`);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", width: "100%" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 16px",
          borderBottom: "1px solid #e5e7eb",
          backgroundColor: "#f8fafc",
          fontFamily: "system-ui, sans-serif",
          fontSize: "14px",
        }}
      >
        <div>
          <strong>Visualify Phase 0 Spike</strong>
          <span data-testid="element-count" style={{ marginLeft: "12px", color: "#475569" }}>
            Elements: {elementCount}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {loadError && (
            <span role="alert" style={{ color: "#b91c1c" }}>
              {loadError}
            </span>
          )}
          <label style={{ cursor: "pointer", color: "#0f172a" }}>
            Load .excalidraw JSON:{" "}
            <input
              type="file"
              accept=".excalidraw,.json,application/json"
              onChange={handleFileUpload}
              data-testid="scene-file-input"
            />
          </label>
        </div>
      </header>

      <main
        data-testid="excalidraw-container"
        style={{ flex: 1, minHeight: "400px", width: "100%", position: "relative" }}
      >
        <Excalidraw
          key={sceneKey}
          initialData={activeScene}
          onChange={(elements) => {
            setElementCount(elements.filter((el) => !el.isDeleted).length);
          }}
        />
      </main>
    </div>
  );
}
