import { globalRenderSemaphore, renderScene } from "@visualify/worker";

/**
 * Server-side scene renderer (Excalidraw CLI + headless browser) backed by the
 * process-wide global render semaphore so pipeline compiles, exports, previews,
 * and ZIP slides never exceed `RENDER_CONCURRENCY` simultaneous browsers.
 */
export function createCliRenderer({ browserPath, timeoutMs, semaphore = globalRenderSemaphore } = {}) {
  return {
    /** @returns {Promise<{ buffer: Buffer, width: number|null, height: number|null, bytes: number }>} */
    async render({ scene, format, theme = "light", transparent = false, signal } = {}) {
      const work = async () => {
        const out = await renderScene({ sceneJson: scene, format, theme, transparent, browserPath, timeoutMs, signal, semaphore });
        return { buffer: out.buffer, width: out.width, height: out.height, bytes: out.bytes };
      };
      return semaphore ? semaphore.run(work, { signal }) : work();
    },
  };
}
