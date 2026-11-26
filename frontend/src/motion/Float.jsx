import clsx from "clsx";

/**
 * Gentle idle vertical drift for decorative/expressive marketing elements.
 * Uses compositor-only translate3d animation and pauses automatically under reduced motion.
 */
export function Float({ children, className, delay = 0, enabled = true, ...rest }) {
  return (
    <div
      className={clsx(enabled && "vf-float", className)}
      style={enabled ? { "--float-delay": `${delay}ms` } : undefined}
      {...rest}
    >
      {children}
    </div>
  );
}
