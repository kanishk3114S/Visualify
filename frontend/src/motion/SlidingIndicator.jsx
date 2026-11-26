import clsx from "clsx";
import { useEffect, useLayoutEffect, useState } from "react";

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Sliding background highlight pill tracking an active tab or navigation item inside a container.
 * Uses transform translateX + width from DOM measurement ONLY when `activeIndex` changes (never per-frame).
 */
export function SlidingIndicator({
  containerRef,
  activeIndex,
  selector = "[data-slide-item]",
  className,
  pillClassName,
}) {
  const [rect, setRect] = useState(null);

  useIsomorphicLayoutEffect(() => {
    const container = containerRef?.current;
    if (!container || activeIndex < 0) {
      setRect(null);
      return;
    }

    const update = () => {
      const items = container.querySelectorAll(selector);
      const target = items[activeIndex];
      if (!target) {
        setRect(null);
        return;
      }
      setRect({
        left: target.offsetLeft,
        top: target.offsetTop,
        width: target.offsetWidth,
        height: target.offsetHeight,
      });
    };

    update();

    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(container);
    return () => ro.disconnect();
  }, [activeIndex, containerRef, selector]);

  if (!rect) return null;

  return (
    <span
      aria-hidden="true"
      className={clsx(
        "pointer-events-none absolute rounded-md bg-surface shadow-xs transition-[transform,width,height] duration-200 ease-[var(--ease-out)]",
        pillClassName,
        className
      )}
      style={{
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        transform: `translate3d(${rect.left}px, ${rect.top}px, 0)`,
        top: 0,
        left: 0,
      }}
    />
  );
}
