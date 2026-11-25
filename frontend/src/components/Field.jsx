import { forwardRef, useId } from "react";
import clsx from "clsx";
import { AlertCircle } from "lucide-react";

const CONTROL =
  "block w-full rounded-md border bg-white px-3 text-stone-900 placeholder:text-stone-400 shadow-xs transition-colors disabled:bg-stone-100 disabled:text-stone-500";

function controlState(error) {
  return error ? "border-red-600 focus-visible:outline-red-700" : "border-stone-300 hover:border-stone-400";
}

/**
 * Labelled form field with hint + error wiring (aria-invalid, aria-describedby).
 * Errors are shown with an icon AND text, never colour alone.
 */
function FieldShell({ id, label, hint, error, required, counter, children }) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-stone-800">
          {label}
          {required && (
            <span className="ml-0.5 text-red-700" aria-hidden="true">
              *
            </span>
          )}
        </label>
        {counter}
      </div>
      {children({ describedBy: [hintId, errorId].filter(Boolean).join(" ") || undefined })}
      {hint && !error && (
        <p id={hintId} className="text-xs text-stone-600">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="flex items-start gap-1.5 text-sm text-red-700" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

export const TextField = forwardRef(function TextField(
  { label, hint, error, required, className, type = "text", counter, ...props },
  ref
) {
  const autoId = useId();
  const id = props.id ?? autoId;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} required={required} counter={counter}>
      {({ describedBy }) => (
        <input
          ref={ref}
          id={id}
          type={type}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          aria-required={required || undefined}
          className={clsx(CONTROL, "h-10", controlState(error), className)}
          {...props}
        />
      )}
    </FieldShell>
  );
});

export const TextAreaField = forwardRef(function TextAreaField(
  { label, hint, error, required, className, rows = 4, counter, ...props },
  ref
) {
  const autoId = useId();
  const id = props.id ?? autoId;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} required={required} counter={counter}>
      {({ describedBy }) => (
        <textarea
          ref={ref}
          id={id}
          rows={rows}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={clsx(CONTROL, "py-2", controlState(error), className)}
          {...props}
        />
      )}
    </FieldShell>
  );
});

export const SelectField = forwardRef(function SelectField(
  { label, hint, error, className, children, ...props },
  ref
) {
  const autoId = useId();
  const id = props.id ?? autoId;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      {({ describedBy }) => (
        <select
          ref={ref}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={clsx(CONTROL, "h-10", controlState(error), className)}
          {...props}
        >
          {children}
        </select>
      )}
    </FieldShell>
  );
});

/** "12 / 300" character counter that turns red (with text) when over the limit. */
export function CharCounter({ value = "", max }) {
  const length = value.length;
  const over = length > max;
  return (
    <span className={clsx("text-xs tabular-nums", over ? "font-medium text-red-700" : "text-stone-500")} aria-live="polite">
      {length} / {max}
      {over && <span className="sr-only"> - over the limit</span>}
    </span>
  );
}

/** Form-level error banner. */
export function FormAlert({ children, tone = "error" }) {
  if (!children) return null;
  const tones = {
    error: "border-red-200 bg-red-50 text-red-800",
    success: "border-accent-100 bg-accent-50 text-accent-900",
    info: "border-stone-200 bg-stone-50 text-stone-800",
  };
  return (
    <div role={tone === "error" ? "alert" : "status"} className={clsx("rounded-md border px-3 py-2.5 text-sm", tones[tone])}>
      {children}
    </div>
  );
}
