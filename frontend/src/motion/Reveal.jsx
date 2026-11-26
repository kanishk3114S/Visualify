import clsx from "clsx";
import { useInView } from "./useInView.js";

/**
 * Progressive scroll/entry reveal wrapper.
 * Visible by default (opacity: 1) when JS hasn't marked `data-motion="ready"` on <html>,
 * or when `prefers-reduced-motion: reduce` is active.
 */
export function Reveal({
  as: Tag = "div",
  children,
  className,
  delay = 0,
  y = 12,
  x = 0,
  immediate = false,
  ...rest
}) {
  const { ref, inView } = useInView();
  const isVisible = immediate || inView;

  return (
    <Tag
      ref={ref}
      className={clsx("vf-reveal", isVisible && "is-visible", className)}
      style={{
        "--reveal-delay": `${delay}ms`,
        "--reveal-y": `${y}px`,
        "--reveal-x": `${x}px`,
      }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
