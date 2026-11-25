import { renderScene } from "@visualify/worker";

/**
 * Server-side scene renderer (Excalidraw CLI + headless browser) with a small
 * concurrency cap so bursts of exports can't launch unbounded browsers.
 */
export function createCliRenderer({ browserPath, timeoutMs, maxConcurrent = 2 } = {}) {
  let active = 0;
  const waiting = [];
  const acquire = () => {
    if (active < maxConcurrent) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => waiting.push(resolve));
  };
  // Hand the slot straight to the next waiter (no window where a newcomer can overtake).
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  };

  return {
    /** @returns {Promise<{ buffer: Buffer, width: number|null, height: number|null, bytes: number }>} */
    async render({ scene, format, theme = "light", transparent = false }) {
      await acquire();
      try {
        const out = await renderScene({ sceneJson: scene, format, theme, transparent, browserPath, timeoutMs });
        return { buffer: out.buffer, width: out.width, height: out.height, bytes: out.bytes };
      } finally {
        release();
      }
    },
  };
}
