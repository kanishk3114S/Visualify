import { useEffect, useId, useRef } from "react";
import { Button } from "./Button.jsx";

/**
 * Accessible confirmation dialog built on the native <dialog> element
 * (showModal gives focus trapping, Esc-to-close and an inert backdrop).
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  loading = false,
  onConfirm,
  onCancel,
}) {
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
      aria-describedby={descId}
      onCancel={(e) => {
        e.preventDefault();
        if (!loading) onCancel();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-stone-200 bg-surface p-0 text-stone-900 shadow-xl backdrop:bg-black/50"
    >
      <div className="space-y-2 p-6">
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        <p id={descId} className="text-sm text-stone-600">
          {description}
        </p>
      </div>
      <div className="flex flex-col-reverse gap-2 border-t border-stone-100 bg-stone-50 px-6 py-4 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel} disabled={loading} autoFocus>
          {cancelLabel}
        </Button>
        <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} loading={loading}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
