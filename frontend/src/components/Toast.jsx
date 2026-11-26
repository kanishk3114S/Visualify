import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";

const ToastContext = createContext(null);
const DURATION_MS = 5000;

const TONES = {
  success: { icon: CheckCircle2, className: "border-accent-100 bg-surface text-stone-900", iconClass: "text-accent-700" },
  error: { icon: AlertTriangle, className: "border-red-200 bg-surface text-stone-900", iconClass: "text-red-700" },
  info: { icon: Info, className: "border-stone-200 bg-surface text-stone-900", iconClass: "text-stone-600" },
};

function ToastItem({ toast, onDismiss }) {
  const { icon: Icon, className, iconClass } = TONES[toast.tone] ?? TONES.info;
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), DURATION_MS);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);
  return (
    <li
      className={clsx(
        "animate-fade-up pointer-events-auto relative overflow-hidden flex w-full items-start gap-3 rounded-lg border px-4 py-3 shadow-lg",
        className
      )}
      data-testid="toast"
    >
      <Icon className={clsx("mt-0.5 h-5 w-5 shrink-0", iconClass)} aria-hidden="true" />
      <p className="flex-1 text-sm">{toast.message}</p>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="-m-1 inline-flex min-h-11 min-w-11 items-center justify-center rounded p-1 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 sm:min-h-0 sm:min-w-0"
        aria-label="Dismiss notification"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
      <span className="animate-toast-progress absolute inset-x-0 bottom-0 h-0.5 bg-accent-700/40" aria-hidden="true" />
    </li>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const counter = useRef(0);

  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  const show = useCallback((message, tone = "info") => {
    counter.current += 1;
    const id = counter.current;
    setToasts((list) => [...list.slice(-3), { id, message, tone }]);
  }, []);

  const api = useMemo(
    () => ({
      success: (m) => show(m, "success"),
      error: (m) => show(m, "error"),
      info: (m) => show(m, "info"),
    }),
    [show]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Polite live region so screen readers hear every toast. */}
      <div aria-live="polite" aria-atomic="false" className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center p-4 sm:justify-end">
        <ol className="flex w-full max-w-sm flex-col gap-2">
          {toasts.map((t) => (
            <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
          ))}
        </ol>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
