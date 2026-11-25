import { useEffect, useId, useRef } from "react";
import clsx from "clsx";
import { X } from "lucide-react";

/**
 * Accessible modal on the native <dialog> element (focus trap, Esc to close,
 * inert backdrop). Children render the body; `footer` the action row.
 */
export function Modal({ open, title, description, onClose, children, footer, size = "md", busy = false, testId }) {
  const ref = useRef(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      data-testid={testId}
      className={clsx(
        "m-auto w-[calc(100%-2rem)] rounded-xl border border-stone-200 bg-surface p-0 text-stone-900 shadow-xl backdrop:bg-black/50 open:animate-fade-up",
        size === "lg" ? "max-w-3xl" : size === "sm" ? "max-w-sm" : "max-w-md"
      )}
    >
      {open && (
        <>
          <div className="flex items-start justify-between gap-4 px-6 pt-6">
            <div className="space-y-1">
              <h2 id={titleId} className="text-lg font-semibold">
                {title}
              </h2>
              {description && (
                <p id={descId} className="text-sm text-stone-600">
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="-m-1 rounded-md p-1.5 text-stone-500 hover:bg-stone-100 hover:text-stone-900 disabled:opacity-50"
              aria-label="Close dialog"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="px-6 py-5">{children}</div>
          {footer && (
            <div className="flex flex-col-reverse gap-2 rounded-b-xl border-t border-stone-100 bg-stone-50 px-6 py-4 sm:flex-row sm:justify-end">
              {footer}
            </div>
          )}
        </>
      )}
    </dialog>
  );
}
