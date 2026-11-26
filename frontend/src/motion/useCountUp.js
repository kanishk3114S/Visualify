import { useEffect, useState } from "react";
import { useReducedMotion } from "./useReducedMotion.js";

/**
 * Deterministic ease-out cubic step computation, exported for direct unit testing.
 * Returns `target` immediately when `reducedMotion` is true.
 *
 * @param {{ target: number, progress: number, reducedMotion?: boolean }} params
 * @returns {number}
 */
export function computeCountUpStep({ target, progress, reducedMotion = false }) {
  if (!Number.isFinite(target)) return 0;
  if (reducedMotion || progress >= 1) return target;
  if (progress <= 0) return 0;
  const eased = 1 - Math.pow(1 - progress, 3);
  return Math.round(target * eased);
}

/**
 * Animates a numeric counter smoothly from 0 to `target` using `requestAnimationFrame`.
 * Jumps immediately to `target` when `prefers-reduced-motion: reduce` is active.
 *
 * @param {number} target
 * @param {object} [options]
 * @param {number} [options.duration=460]
 * @param {boolean} [options.enabled=true]
 */
export function useCountUp(target, { duration = 460, enabled = true } = {}) {
  const reducedMotion = useReducedMotion();
  const safeTarget = Number.isFinite(target) ? target : 0;
  const [value, setValue] = useState(() => (reducedMotion || !enabled ? safeTarget : 0));

  useEffect(() => {
    if (reducedMotion || !enabled || typeof requestAnimationFrame === "undefined") {
      setValue(safeTarget);
      return;
    }
    if (safeTarget === 0) {
      setValue(0);
      return;
    }

    let rafId = 0;
    const start = performance.now();

    const tick = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      setValue(computeCountUpStep({ target: safeTarget, progress, reducedMotion: false }));
      if (progress < 1) {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [duration, enabled, reducedMotion, safeTarget]);

  return value;
}
