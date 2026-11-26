import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Pure helper usable outside React components and in unit tests.
 * @param {MediaQueryList | ((q: string) => MediaQueryList)} [matcher]
 * @returns {boolean}
 */
export function queryPrefersReducedMotion(matcher) {
  try {
    if (typeof matcher === "function") return Boolean(matcher(QUERY)?.matches);
    if (matcher && typeof matcher.matches === "boolean") return matcher.matches;
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      return Boolean(window.matchMedia(QUERY).matches);
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Reactive hook tracking `(prefers-reduced-motion: reduce)`.
 * Safe in SSR / test environments lacking `window.matchMedia`.
 */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => queryPrefersReducedMotion());

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(QUERY);
    setReduced(Boolean(mql.matches));
    const onChange = (event) => setReduced(Boolean(event.matches));
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
