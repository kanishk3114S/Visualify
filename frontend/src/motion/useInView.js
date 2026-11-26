import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./useReducedMotion.js";

/**
 * One-shot IntersectionObserver hook.
 * Guarantees visibility immediately if IntersectionObserver is unsupported or reduced motion is enabled.
 *
 * @param {object} [options]
 * @param {string} [options.rootMargin="-40px 0px"]
 * @param {number} [options.threshold=0.05]
 * @param {boolean} [options.once=true]
 */
export function useInView({ rootMargin = "-40px 0px", threshold = 0.05, once = true } = {}) {
  const ref = useRef(null);
  const reducedMotion = useReducedMotion();
  const [inView, setInView] = useState(() => {
    if (reducedMotion) return true;
    if (typeof window === "undefined") return true;
    if (typeof IntersectionObserver === "undefined") return true;
    if (typeof document !== "undefined" && document.documentElement.dataset.motion !== "ready") return true;
    return false;
  });

  useEffect(() => {
    if (reducedMotion || inView) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    if (typeof document !== "undefined" && document.documentElement.dataset.motion !== "ready") {
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting || entry.intersectionRatio > 0) {
            setInView(true);
            if (once) observer.disconnect();
            break;
          }
        }
      },
      { rootMargin, threshold }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [inView, once, reducedMotion, rootMargin, threshold]);

  return { ref, inView };
}
