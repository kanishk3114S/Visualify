/**
 * Enables progressive motion reveals when JS is ready, IntersectionObserver is supported,
 * and `(prefers-reduced-motion: reduce)` is NOT active.
 * Keeps `data-motion` unset otherwise so all content renders visible without JS or animation.
 */
export function initMotionReadiness() {
  if (typeof document === "undefined" || typeof window === "undefined") return false;
  if (typeof IntersectionObserver === "undefined") return false;
  const reduced =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) {
    delete document.documentElement.dataset.motion;
    return false;
  }
  document.documentElement.dataset.motion = "ready";
  return true;
}

/** Shared tactile press class matching DESIGN.md `--duration-micro`. */
export const PRESSABLE_CLASS = "vf-press";
