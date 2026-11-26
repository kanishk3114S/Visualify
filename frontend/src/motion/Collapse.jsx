import clsx from "clsx";

/**
 * Smooth height collapse/expand using CSS Grid `0fr -> 1fr` transitions.
 * Preserves layout geometry cleanly without measuring DOM height on every frame.
 */
export function Collapse({ open, children, className, id }) {
  return (
    <div
      id={id}
      data-open={open ? "true" : "false"}
      aria-hidden={!open}
      className={clsx("vf-collapse", className)}
    >
      <div className="vf-collapse-inner" {...(!open ? { inert: "" } : {})}>
        {children}
      </div>
    </div>
  );
}
