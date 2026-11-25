import { lazy, Suspense, useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowLeft, BookmarkPlus, ListTree, MessageSquareText, PenTool } from "lucide-react";
import clsx from "clsx";
import { Badge } from "../../components/Layout.jsx";
import { Spinner } from "../../components/Spinner.jsx";

const WorkspaceCanvas = lazy(() => import("./WorkspaceCanvas.jsx"));

export const VISUAL_TYPE_LABELS = {
  flowchart: "Flowchart",
  sequence: "Sequence diagram",
  mindmap: "Mind map",
  comparison: "Comparison",
  timeline: "Timeline",
  er_diagram: "ER diagram",
  class_diagram: "Class diagram",
};

function PanelHeading({ icon: Icon, children, id }) {
  return (
    <h2 id={id} className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
      <Icon className="h-4 w-4" aria-hidden="true" />
      {children}
    </h2>
  );
}

function OutlinePanel({ plan, warnings, onSelectSection, drawnSectionIds }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-6" data-testid="outline-panel">
      <PanelHeading icon={ListTree} id={headingId}>
        Outline
      </PanelHeading>

      {warnings.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3" role="note" data-testid="generation-warnings">
          <p className="flex items-center gap-2 text-sm font-medium text-amber-900">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            {warnings.length === 1 ? "1 note about this result" : `${warnings.length} notes about this result`}
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-stone-900">Learning objectives</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-700">
          {plan.learningObjectives.map((o) => (
            <li key={o}>{o}</li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-stone-900">Sections</h3>
        <ol className="mt-2 space-y-2">
          {plan.sections.map((s, i) => {
            const drawn = drawnSectionIds.has(s.id);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onSelectSection(s.id)}
                  disabled={!drawn}
                  className="w-full rounded-lg border border-stone-200 bg-white p-3 text-left hover:border-accent-600 disabled:cursor-default disabled:hover:border-stone-200"
                  aria-label={drawn ? `Show section ${i + 1} on the canvas: ${s.title}` : `Section ${i + 1}: ${s.title} (diagram unavailable)`}
                >
                  <span className="block text-sm font-medium text-stone-900">
                    {i + 1}. {s.title}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge tone="accent">{VISUAL_TYPE_LABELS[s.visualType] ?? s.visualType}</Badge>
                    {!drawn && <Badge tone="soon">No diagram</Badge>}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-stone-900">Key concepts</h3>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {[...new Set(plan.sections.flatMap((s) => s.keyConcepts))].map((c) => (
            <li key={c} className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs text-stone-700">
              {c}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function ExplanationPanel({ plan }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-6" data-testid="explanation-panel">
      <PanelHeading icon={MessageSquareText} id={headingId}>
        Explanation
      </PanelHeading>
      <div>
        <h3 className="text-sm font-semibold text-stone-900">Overview</h3>
        <p className="mt-1 text-sm leading-relaxed text-stone-700">{plan.summary}</p>
      </div>
      {plan.sections.map((s, i) => (
        <article key={s.id} aria-labelledby={`${headingId}-${s.id}`}>
          <h3 id={`${headingId}-${s.id}`} className="text-sm font-semibold text-stone-900">
            {i + 1}. {s.title}
          </h3>
          <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-stone-700">{s.explanation}</p>
          {s.relationships.length > 0 && (
            <div className="mt-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Relationships</h4>
              <ul className="mt-1 space-y-1 text-sm text-stone-700">
                {s.relationships.map((r) => (
                  <li key={`${r.from}-${r.label}-${r.to}`}>
                    <span className="font-medium">{r.from}</span> <span className="text-stone-500">→ {r.label} →</span>{" "}
                    <span className="font-medium">{r.to}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}

const TABS = [
  { key: "canvas", label: "Canvas", icon: PenTool },
  { key: "outline", label: "Outline", icon: ListTree },
  { key: "explanation", label: "Explanation", icon: MessageSquareText },
];

/**
 * Generated-result workspace (PRD 6.4). Desktop (>= 1200px): outline | canvas |
 * explanation. Below 1200px a tab bar switches panels; the canvas stays
 * mounted (hidden, not unmounted) so edits are never lost when switching.
 */
export function VisualWorkspace({ job }) {
  const plan = job.learningPlan;
  const [tab, setTab] = useState("canvas");
  const [dirty, setDirty] = useState(false);
  const [focus, setFocus] = useState({ id: null, nonce: 0 });
  const tablistId = useId();

  // Section ids may themselves contain "__", so match by full prefix per section.
  const elementIds = (job.sceneJson?.elements ?? []).map((el) => el.id);
  const drawnSectionIds = new Set(
    plan.sections.filter((s) => elementIds.some((id) => id.startsWith(`${s.id}__`))).map((s) => s.id)
  );
  const types = [...new Set(plan.sections.map((s) => s.visualType))];

  // PRD 6.4: warn before leaving with unsaved edits (saving arrives in Phase 3).
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  function selectSection(id) {
    setTab("canvas");
    setFocus((f) => ({ id, nonce: f.nonce + 1 }));
  }

  const panel = (key) => clsx(tab === key ? "block" : "hidden", "desk:block");

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col lg:h-dvh" data-testid="visual-workspace">
      {/* Top bar */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-stone-200 bg-white px-4 py-3">
        <Link to="/app/create" className="rounded-md p-1.5 text-stone-600 hover:bg-stone-100 hover:text-stone-900" aria-label="Back to create">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold text-stone-900" data-testid="workspace-title">
            {plan.title}
          </h1>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            {types.map((t) => (
              <Badge key={t} tone="accent">
                {VISUAL_TYPE_LABELS[t] ?? t}
              </Badge>
            ))}
          </div>
        </div>
        <p className="text-xs text-stone-600" role="status" data-testid="edit-status">
          {dirty ? "Edited · not saved" : "Generated · no edits"}
        </p>
        <span title="Saving to your library arrives in the next release (Phase 3)." className="inline-flex">
          <button
            type="button"
            disabled
            aria-describedby={`${tablistId}-save-note`}
            className="inline-flex h-9 cursor-not-allowed items-center gap-2 rounded-md border border-stone-300 bg-stone-50 px-3 text-sm font-medium text-stone-500"
          >
            <BookmarkPlus className="h-4 w-4" aria-hidden="true" />
            Save to Library (Phase 3)
          </button>
        </span>
        <p id={`${tablistId}-save-note`} className="sr-only">
          Saving to your library isn't available yet. Your edits stay in this tab until you leave it.
        </p>
      </header>

      {/* Tabs below 1200px */}
      <div role="tablist" aria-label="Workspace panels" id={tablistId} className="flex border-b border-stone-200 bg-white desk:hidden">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`${tablistId}-${key}`}
            aria-selected={tab === key}
            aria-controls={`${tablistId}-${key}-panel`}
            onClick={() => setTab(key)}
            className={clsx(
              "flex flex-1 items-center justify-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium",
              tab === key ? "border-accent-700 text-accent-900" : "border-transparent text-stone-600 hover:text-stone-900"
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 desk:grid desk:grid-cols-[18rem_minmax(0,1fr)_22rem]">
        <aside
          id={`${tablistId}-outline-panel`}
          aria-labelledby={`${tablistId}-outline`}
          className={clsx(panel("outline"), "h-full overflow-y-auto border-stone-200 bg-canvas p-5 desk:border-r")}
        >
          <OutlinePanel plan={plan} warnings={job.warnings} drawnSectionIds={drawnSectionIds} onSelectSection={selectSection} />
        </aside>

        <section
          id={`${tablistId}-canvas-panel`}
          aria-label="Diagram canvas"
          className={clsx(panel("canvas"), "h-full min-h-[24rem]")}
        >
          <div className="flex h-full flex-col">
          <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 md:hidden">
            Editing works best on a larger screen. You can still view, zoom and make small edits here.
          </p>
          <div className="relative min-h-0 flex-1">
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center gap-3 text-stone-600">
                  <Spinner label="Loading canvas" className="text-accent-700" />
                  <span aria-hidden="true">Loading canvas…</span>
                </div>
              }
            >
              <div className="absolute inset-0">
                <WorkspaceCanvas scene={job.sceneJson} focusSectionId={focus.id} focusNonce={focus.nonce} onDirtyChange={setDirty} />
              </div>
            </Suspense>
          </div>
          </div>
        </section>

        <aside
          id={`${tablistId}-explanation-panel`}
          aria-labelledby={`${tablistId}-explanation`}
          className={clsx(panel("explanation"), "h-full overflow-y-auto border-stone-200 bg-white p-5 desk:border-l")}
        >
          <ExplanationPanel plan={plan} />
        </aside>
      </div>
    </div>
  );
}
