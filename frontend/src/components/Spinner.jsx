import clsx from "clsx";

const SIZES = { sm: "h-4 w-4 border-2", md: "h-6 w-6 border-2", lg: "h-8 w-8 border-[3px]" };

/** Loading indicator. Non-decorative spinners announce their label to screen readers. */
export function Spinner({ size = "md", label = "Loading", decorative = false, className }) {
  return (
    <span
      role={decorative ? undefined : "status"}
      aria-hidden={decorative || undefined}
      className={clsx("inline-flex items-center", className)}
    >
      <span
        className={clsx(
          "inline-block animate-spin rounded-full border-current border-r-transparent text-current",
          SIZES[size]
        )}
      />
      {!decorative && <span className="sr-only">{label}</span>}
    </span>
  );
}

/** Centered full-page loading state (used while the session initialises). */
export function FullPageSpinner({ label = "Loading" }) {
  return (
    <div className="flex min-h-dvh items-center justify-center gap-3 text-stone-600" data-testid="page-loading">
      <Spinner size="lg" label={label} className="text-accent-700" />
      <span aria-hidden="true">{label}…</span>
    </div>
  );
}
