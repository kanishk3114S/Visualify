import { useEffect, useRef, useState } from "react";
import { Check, Circle, Loader2, X } from "lucide-react";
import clsx from "clsx";
import { Button } from "../../components/Button.jsx";
import { Card } from "../../components/Layout.jsx";

/** User-facing stage list (PRD 5.10). "rendering" is reserved for preview exports (Phase 3). */
export const STAGES = [
  { key: "queued", label: "Queued" },
  { key: "validating", label: "Validating request" },
  { key: "planning", label: "Planning visuals" },
  { key: "composing", label: "Composing scene" },
  { key: "persisting", label: "Saving result" },
];

const ORDER = STAGES.map((s) => s.key);

function stageState(stageKey, current) {
  const at = ORDER.indexOf(current);
  const idx = ORDER.indexOf(stageKey);
  if (at === -1) return "pending";
  if (idx < at) return "done";
  if (idx === at) return "active";
  return "pending";
}

export function stageLabel(status) {
  if (status === "cancelling") return "Cancelling…";
  if (status === "completed") return "Finishing up…";
  return STAGES.find((s) => s.key === status)?.label ?? "Working";
}

/**
 * Accessible progress for an active job: a native progressbar, a stage list
 * whose state is conveyed by icon AND text (not colour alone), and a polite
 * live region that announces stage changes only (not every percent).
 */
export function GenerationProgress({ status, progress, prompt, polling, onCancel, cancelling }) {
  const [announcement, setAnnouncement] = useState("");
  const lastStatus = useRef(null);
  useEffect(() => {
    if (status !== lastStatus.current) {
      lastStatus.current = status;
      setAnnouncement(`${stageLabel(status)}`);
    }
  }, [status]);

  const isCancelling = status === "cancelling" || cancelling;

  return (
    <Card className="mx-auto max-w-2xl p-6 sm:p-8" data-testid="generation-progress">
      <h1 className="text-xl font-semibold tracking-tight text-stone-900">Creating your visual notes</h1>
      {prompt && (
        <p className="mt-2 line-clamp-3 text-sm text-stone-600" title={prompt}>
          “{prompt}”
        </p>
      )}

      <div className="mt-6">
        <div className="mb-2 flex items-baseline justify-between text-sm">
          <span className="font-medium text-stone-800">{stageLabel(status)}</span>
          <span className="tabular-nums text-stone-600">{progress}%</span>
        </div>
        <div
          role="progressbar"
          aria-label="Generation progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          aria-valuetext={`${stageLabel(status)}, ${progress} percent`}
          className="h-2 w-full overflow-hidden rounded-full bg-stone-200"
        >
          <div className="h-full rounded-full bg-accent-700 transition-[width] duration-500 ease-out" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <ol className="mt-6 space-y-3" aria-label="Generation stages">
        {STAGES.map((s) => {
          const state = isCancelling ? (stageState(s.key, status) === "done" ? "done" : "pending") : stageState(s.key, status);
          const Icon = state === "done" ? Check : state === "active" ? Loader2 : Circle;
          return (
            <li key={s.key} className="flex items-center gap-3 text-sm" data-state={state}>
              <Icon
                className={clsx(
                  "h-4 w-4 shrink-0",
                  state === "done" && "text-accent-700",
                  state === "active" && "animate-spin text-accent-700 motion-reduce:animate-none",
                  state === "pending" && "text-stone-400"
                )}
                aria-hidden="true"
              />
              <span className={state === "pending" ? "text-stone-500" : "text-stone-900"}>{s.label}</span>
              <span className="sr-only">{state === "done" ? "(done)" : state === "active" ? "(in progress)" : "(waiting)"}</span>
            </li>
          );
        })}
      </ol>

      <p className="sr-only" aria-live="polite" data-testid="stage-announcement">
        {announcement}
      </p>

      <div className="mt-8 flex flex-col-reverse gap-3 border-t border-stone-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-stone-500">
          {polling ? "Live updates paused - checking for progress every few seconds." : "Generation keeps running if you leave; reopen this page to see the result."}
        </p>
        <Button variant="secondary" onClick={onCancel} disabled={isCancelling} loading={cancelling} loadingText="Cancelling…">
          <X className="h-4 w-4" aria-hidden="true" />
          {isCancelling ? "Cancelling…" : "Cancel"}
        </Button>
      </div>
    </Card>
  );
}
