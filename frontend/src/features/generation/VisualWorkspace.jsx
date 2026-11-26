import { lazy, Suspense, useId, useRef, useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  BookmarkPlus,
  Crosshair,
  Eye,
  FileText,
  Image as ImageIcon,
  ListTree,
  Maximize2,
  MessageSquareText,
  Palette,
  PenTool,
  RefreshCw,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import clsx from "clsx";
import { Badge } from "../../components/Layout.jsx";
import { Spinner } from "../../components/Spinner.jsx";
import { Button } from "../../components/Button.jsx";
import { SelectField, TextAreaField, TextField } from "../../components/Field.jsx";
import { SegmentedControl } from "../../components/SegmentedControl.jsx";
import { toScenePayload } from "../../lib/autosave.js";
import { formatPageRangeLabel } from "../../lib/sourceFiles.js";
import { SaveToLibraryDialog } from "../notes/SaveToLibraryDialog.jsx";

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

const COLOR_LEGEND = [
  { label: "Core topic / start", swatch: "bg-[#ccfbf1] border-[#0f766e]" },
  { label: "Process / structure", swatch: "bg-[#e0e7ff] border-[#3730a3]" },
  { label: "Decision / data", swatch: "bg-[#fef3c7] border-[#b45309]" },
  { label: "Outcome / highlight", swatch: "bg-[#ffe4e6] border-[#be123c]" },
  { label: "Detail / branch", swatch: "bg-[#d1fae5] border-[#047857]" },
];

function PanelHeading({ icon: Icon, children, id }) {
  return (
    <h2 id={id} className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
      <Icon className="h-4 w-4" aria-hidden="true" />
      {children}
    </h2>
  );
}

export function SourceRefChips({ refs }) {
  if (!Array.isArray(refs) || refs.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Source references">
      {refs.map((ref, idx) => {
        const label =
          ref.label ??
          (Array.isArray(ref.pages) && ref.pages.length
            ? `Pages ${ref.pages.join(", ")}`
            : ref.page
              ? `Page ${ref.page}`
              : "Source");
        return (
          <li key={`${label}-${idx}`} title={ref.snippet}>
            <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-700 ring-1 ring-inset ring-stone-200">
              {label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function OutlinePanel({ plan, warnings, onSelectSection, activeSectionId, drawnSectionIds, sourceInfo }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-6" data-testid="outline-panel">
      <PanelHeading icon={ListTree} id={headingId}>
        Outline
      </PanelHeading>

      {sourceInfo && (
        <div className="rounded-lg border border-stone-200 bg-surface p-3" data-testid="workspace-source-badge">
          <div className="flex items-center gap-2 text-xs font-semibold text-stone-800">
            {sourceInfo.type === "pdf" ? (
              <FileText className="h-3.5 w-3.5 text-accent-700" aria-hidden="true" />
            ) : (
              <ImageIcon className="h-3.5 w-3.5 text-accent-700" aria-hidden="true" />
            )}
            <span className="truncate">{sourceInfo.label}</span>
          </div>
          {sourceInfo.sublabel && <p className="mt-1 text-xs text-stone-600">{sourceInfo.sublabel}</p>}
          {sourceInfo.previewUrl && (
            <details className="mt-2">
              <summary className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-accent-700 hover:text-accent-800">
                <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                Preview source image
              </summary>
              <img
                src={sourceInfo.previewUrl}
                alt={`Source image ${sourceInfo.label}`}
                className="mt-2 max-h-40 w-full rounded border border-stone-200 object-contain bg-stone-50"
              />
            </details>
          )}
        </div>
      )}

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
            const active = activeSectionId === s.id;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onSelectSection(s.id)}
                  disabled={!drawn}
                  aria-current={active ? "true" : undefined}
                  className={clsx(
                    "w-full rounded-lg border bg-surface p-3 text-left transition-all duration-150 active:scale-[0.99] disabled:cursor-default",
                    active
                      ? "border-accent-700 ring-2 ring-accent-700/20"
                      : "border-stone-200 hover:border-accent-600 disabled:hover:border-stone-200"
                  )}
                  aria-label={drawn ? `Show section ${i + 1} on the canvas: ${s.title}` : `Section ${i + 1}: ${s.title} (diagram unavailable)`}
                >
                  <span className="block text-sm font-medium text-stone-900">
                    {i + 1}. {s.title}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge tone="accent">{VISUAL_TYPE_LABELS[s.visualType] ?? s.visualType}</Badge>
                    {!drawn && <Badge tone="soon">No diagram</Badge>}
                  </span>
                  <SourceRefChips refs={s.sourceRefs} />
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

export function ExplanationPanel({
  plan,
  activeSectionId,
  drawnSectionIds,
  onSelectSection,
  onRegenerateSection,
  regeneratingSectionId = null,
}) {
  const headingId = useId();
  const [editingId, setEditingId] = useState(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftExplanation, setDraftExplanation] = useState("");
  const [draftVisualType, setDraftVisualType] = useState("flowchart");
  const [draftInstruction, setDraftInstruction] = useState("");

  function openEdit(section) {
    setEditingId(section.id);
    setDraftTitle(section.title);
    setDraftExplanation(section.explanation);
    setDraftVisualType(section.visualType);
    setDraftInstruction("");
  }

  async function submitRegenerate(e, sectionId) {
    e.preventDefault();
    if (!onRegenerateSection) return;
    const ok = await onRegenerateSection(sectionId, {
      title: draftTitle.trim() || undefined,
      explanation: draftExplanation.trim() || undefined,
      visualType: draftVisualType,
      instruction: draftInstruction.trim() || undefined,
    });
    if (ok) setEditingId(null);
  }

  return (
    <section aria-labelledby={headingId} className="space-y-6" data-testid="explanation-panel">
      <PanelHeading icon={MessageSquareText} id={headingId}>
        Explanation
      </PanelHeading>
      <div>
        <h3 className="text-sm font-semibold text-stone-900">Overview</h3>
        <p className="mt-1 text-sm leading-relaxed text-stone-700">{plan.summary}</p>
      </div>
      {plan.sections.map((s, i) => {
        const active = activeSectionId === s.id;
        const drawn = drawnSectionIds?.has(s.id);
        const isEditing = editingId === s.id;
        const busy = regeneratingSectionId === s.id;
        return (
          <article
            key={s.id}
            aria-labelledby={`${headingId}-${s.id}`}
            className={clsx(
              "rounded-lg border p-3 transition-colors",
              active ? "border-accent-700/60 bg-accent-50/40" : "border-transparent"
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <h3 id={`${headingId}-${s.id}`} className="text-sm font-semibold text-stone-900">
                {i + 1}. {s.title}
              </h3>
              <div className="flex shrink-0 items-center gap-1">
                {drawn && onSelectSection && (
                  <button
                    type="button"
                    onClick={() => onSelectSection(s.id)}
                    className="rounded px-1.5 py-0.5 text-xs font-medium text-accent-700 hover:bg-accent-50 hover:text-accent-800"
                    aria-label={`Focus section ${i + 1} on canvas`}
                  >
                    Focus
                  </button>
                )}
                {onRegenerateSection && (
                  <button
                    type="button"
                    onClick={() => (isEditing ? setEditingId(null) : openEdit(s))}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-stone-700 hover:bg-stone-100 hover:text-stone-900"
                    data-testid={`edit-section-${s.id}`}
                  >
                    <RefreshCw className="h-3 w-3" aria-hidden="true" />
                    {isEditing ? "Cancel" : "Regenerate"}
                  </button>
                )}
              </div>
            </div>

            {isEditing ? (
              <form onSubmit={(e) => submitRegenerate(e, s.id)} className="mt-3 space-y-2.5 rounded-lg border border-stone-200 bg-canvas p-3" data-testid={`regenerate-form-${s.id}`}>
                <TextField label="Section title" value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} maxLength={160} />
                <SelectField label="Diagram type" value={draftVisualType} onChange={(e) => setDraftVisualType(e.target.value)}>
                  {Object.entries(VISUAL_TYPE_LABELS).map(([val, label]) => (
                    <option key={val} value={val}>
                      {label}
                    </option>
                  ))}
                </SelectField>
                <TextAreaField label="Outline / explanation" rows={3} value={draftExplanation} onChange={(e) => setDraftExplanation(e.target.value)} maxLength={2000} />
                <TextField label="Regeneration note (optional)" placeholder="e.g. Simplify into 4 steps" value={draftInstruction} onChange={(e) => setDraftInstruction(e.target.value)} maxLength={600} />
                <Button type="submit" size="sm" loading={busy} loadingText="Regenerating…" data-testid={`regenerate-submit-${s.id}`}>
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  Apply &amp; regenerate
                </Button>
              </form>
            ) : (
              <>
                <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-stone-700">{s.explanation}</p>
                <SourceRefChips refs={s.sourceRefs} />
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
              </>
            )}
          </article>
        );
      })}
    </section>
  );
}

const TABS = [
  { key: "canvas", label: "Canvas", icon: PenTool },
  { key: "outline", label: "Outline", icon: ListTree },
  { key: "explanation", label: "Explanation", icon: MessageSquareText },
];

export function drawnSections(plan, scene) {
  const ids = (scene?.elements ?? []).map((el) => el.id);
  return new Set((plan?.sections ?? []).filter((s) => ids.some((id) => id.startsWith(`${s.id}__`))).map((s) => s.id));
}

function buildSourceInfo({ sourceType, sourceFile, pageRange }) {
  if (!sourceFile && (!sourceType || sourceType === "prompt")) return null;
  const type = sourceType && sourceType !== "prompt" ? sourceType : sourceFile?.mimeType === "application/pdf" ? "pdf" : "image";
  return {
    type,
    label: sourceFile?.originalName ?? (type === "pdf" ? "PDF source" : "Image source"),
    sublabel:
      type === "pdf"
        ? formatPageRangeLabel(pageRange, sourceFile?.pageCount)
        : sourceFile?.width && sourceFile?.height
          ? `${sourceFile.width} × ${sourceFile.height}`
          : "Uploaded study image",
    previewUrl: sourceFile?.previewUrl ?? null,
  };
}

export function WorkspaceShell({
  title,
  plan,
  scene,
  warnings = [],
  sourceType = "prompt",
  sourceFile = null,
  pageRange = null,
  backTo,
  backLabel,
  status,
  actions,
  canvasKey = 0,
  onSceneChange,
  onDirtyChange,
  onSelectionChange,
  onCanvasReady,
  selectedCount = 0,
  onExplainSelection,
  explainPending = false,
  renderAssistantPanel,
  onRegenerateSection,
  regeneratingSectionId = null,
}) {
  const [tab, setTab] = useState("canvas");
  const [rightTab, setRightTab] = useState("explanation");
  const [tabletDrawer, setTabletDrawer] = useState(null); // null | "outline" | "explanation" (768..1199px)
  const [focus, setFocus] = useState({ id: null, nonce: 0 });
  const [fitNonce, setFitNonce] = useState(0);
  const [resetNonce, setResetNonce] = useState(0);
  const [legendOpen, setLegendOpen] = useState(false);
  const tablistId = useId();
  const drawnSectionIds = drawnSections(plan, scene);
  const drawnList = (plan?.sections ?? []).filter((s) => drawnSectionIds.has(s.id));
  const types = [...new Set((plan?.sections ?? []).map((s) => s.visualType))];
  const sourceInfo = buildSourceInfo({ sourceType, sourceFile, pageRange });

  useEffect(() => {
    if (!tabletDrawer) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setTabletDrawer(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tabletDrawer]);

  function selectSection(id) {
    setTab("canvas");
    setTabletDrawer(null);
    setFocus((f) => ({ id, nonce: f.nonce + 1 }));
  }

  function cycleSectionFocus() {
    if (drawnList.length === 0) return;
    const idx = drawnList.findIndex((s) => s.id === focus.id);
    const next = drawnList[(idx + 1) % drawnList.length];
    selectSection(next.id);
  }

  function triggerExplainSelection() {
    setTab("explanation");
    setRightTab("assistant");
    setTabletDrawer("explanation");
    onExplainSelection?.();
  }

  // Mobile (<768px) uses tabs; Tablet (768..1199px) keeps Canvas central with collapsible drawers; Desktop (>=1200px) uses 3-column grid.
  const panel = (key) => {
    if (key === "canvas") return clsx(tab === "canvas" ? "block" : "hidden", "md:block");
    return clsx(tab === key ? "block md:hidden" : "hidden", "desk:block");
  };

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col lg:h-dvh" data-testid="visual-workspace">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-stone-200 bg-surface px-4 py-3">
        <Link to={backTo} className="rounded-md p-1.5 text-stone-600 hover:bg-stone-100 hover:text-stone-900" aria-label={backLabel}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold text-stone-900" data-testid="workspace-title">
            {title}
          </h1>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            {types.map((t) => (
              <Badge key={t} tone="accent">
                {VISUAL_TYPE_LABELS[t] ?? t}
              </Badge>
            ))}
            {sourceType && sourceType !== "prompt" && (
              <Badge tone="neutral">{sourceType === "pdf" ? "PDF" : "Image"}</Badge>
            )}
          </div>
        </div>
        {status}
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>

      <div role="tablist" aria-label="Workspace panels" id={tablistId} className="flex border-b border-stone-200 bg-surface md:hidden">
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
              "flex flex-1 items-center justify-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
              tab === key ? "border-accent-700 text-accent-900" : "border-transparent text-stone-600 hover:text-stone-900"
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {/* Tablet bar (768..1199px, PRD 13.2): keep canvas central with collapsible side drawers. */}
      <div className="hidden items-center justify-between border-b border-stone-200 bg-surface px-4 py-1.5 md:flex desk:hidden" data-testid="tablet-panel-bar">
        <Button
          size="sm"
          variant={tabletDrawer === "outline" ? "primary" : "secondary"}
          aria-expanded={tabletDrawer === "outline"}
          onClick={() => setTabletDrawer((d) => (d === "outline" ? null : "outline"))}
          data-testid="tablet-outline-toggle"
        >
          <ListTree className="h-3.5 w-3.5" aria-hidden="true" />
          Outline
        </Button>
        <Button
          size="sm"
          variant={tabletDrawer === "explanation" ? "primary" : "secondary"}
          aria-expanded={tabletDrawer === "explanation"}
          onClick={() => setTabletDrawer((d) => (d === "explanation" ? null : "explanation"))}
          data-testid="tablet-assistant-toggle"
        >
          <MessageSquareText className="h-3.5 w-3.5" aria-hidden="true" />
          {renderAssistantPanel ? "Notes & Assistant" : "Explanation"}
        </Button>
      </div>

      <div className="relative min-h-0 flex-1 desk:grid desk:grid-cols-[18rem_minmax(0,1fr)_22rem]">
        <aside
          id={`${tablistId}-outline-panel`}
          aria-labelledby={`${tablistId}-outline`}
          className={clsx(panel("outline"), "h-full overflow-y-auto border-stone-200 bg-canvas p-5 desk:border-r")}
        >
          {plan ? (
            <OutlinePanel
              plan={plan}
              warnings={warnings}
              drawnSectionIds={drawnSectionIds}
              activeSectionId={focus.id}
              onSelectSection={selectSection}
              sourceInfo={sourceInfo}
            />
          ) : (
            <p className="text-sm text-stone-600">This note has no outline.</p>
          )}
        </aside>

        <section id={`${tablistId}-canvas-panel`} aria-label="Diagram canvas" className={clsx(panel("canvas"), "h-full min-h-[24rem]")}>
          <div className="flex h-full flex-col">
            <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 md:hidden">
              Editing works best on a larger screen. You can still view, zoom and make small edits here.
            </p>
            <div className="relative flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 bg-canvas/80 px-3 py-1.5" data-testid="canvas-toolbar">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setFitNonce((n) => n + 1)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-surface px-2.5 py-1 text-xs font-medium text-stone-800 hover:bg-stone-100"
                >
                  <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Fit to screen
                </button>
                {drawnList.length > 0 && (
                  <button
                    type="button"
                    onClick={cycleSectionFocus}
                    className="inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-surface px-2.5 py-1 text-xs font-medium text-stone-800 hover:bg-stone-100"
                  >
                    <Crosshair className="h-3.5 w-3.5" aria-hidden="true" />
                    Zoom to section
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setResetNonce((n) => n + 1)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-surface px-2.5 py-1 text-xs font-medium text-stone-800 hover:bg-stone-100"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  Reset view
                </button>
              </div>
              <button
                type="button"
                aria-expanded={legendOpen}
                onClick={() => setLegendOpen((v) => !v)}
                className={clsx(
                  "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                  legendOpen
                    ? "border-accent-700 bg-accent-50 text-accent-900"
                    : "border-stone-300 bg-surface text-stone-800 hover:bg-stone-100"
                )}
              >
                <Palette className="h-3.5 w-3.5" aria-hidden="true" />
                Color guide
              </button>
              {selectedCount > 0 && onExplainSelection && (
                <Button
                  size="sm"
                  loading={explainPending}
                  loadingText="Explaining…"
                  onClick={triggerExplainSelection}
                  data-testid="explain-selection-bar"
                >
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  Explain selection ({selectedCount})
                </Button>
              )}
              {legendOpen && (
                <div
                  role="region"
                  aria-label="Diagram color guide"
                  data-testid="color-legend"
                  className="w-full rounded-lg border border-stone-200 bg-surface p-2.5 text-xs text-stone-700 shadow-xs"
                >
                  <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {COLOR_LEGEND.map((item) => (
                      <li key={item.label} className="inline-flex items-center gap-1.5">
                        <span className={clsx("h-3 w-3 rounded-sm border", item.swatch)} aria-hidden="true" />
                        <span>{item.label}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
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
                  <WorkspaceCanvas
                    key={canvasKey}
                    scene={scene}
                    focusSectionId={focus.id}
                    focusNonce={focus.nonce}
                    fitNonce={fitNonce}
                    resetNonce={resetNonce}
                    onDirtyChange={onDirtyChange}
                    onSceneChange={onSceneChange}
                    onSelectionChange={onSelectionChange}
                    onReady={onCanvasReady}
                  />
                </div>
              </Suspense>
            </div>
          </div>
        </section>

        <aside
          id={`${tablistId}-explanation-panel`}
          aria-labelledby={`${tablistId}-explanation`}
          className={clsx(panel("explanation"), "h-full overflow-y-auto border-stone-200 bg-surface p-5 desk:border-l")}
        >
          {renderAssistantPanel && (
            <div className="mb-4">
              <SegmentedControl
                label="Right panel view"
                size="sm"
                testId="right-panel-switch"
                value={rightTab}
                onChange={setRightTab}
                options={[
                  { value: "explanation", label: "Explanation", icon: MessageSquareText },
                  { value: "assistant", label: "Study Assistant", icon: Sparkles },
                ]}
              />
            </div>
          )}
          {renderAssistantPanel && rightTab === "assistant" ? (
            renderAssistantPanel({ onFocusSection: selectSection })
          ) : plan ? (
            <ExplanationPanel
              plan={plan}
              activeSectionId={focus.id}
              drawnSectionIds={drawnSectionIds}
              onSelectSection={selectSection}
              onRegenerateSection={onRegenerateSection}
              regeneratingSectionId={regeneratingSectionId}
            />
          ) : (
            <p className="text-sm text-stone-600">No explanation available.</p>
          )}
        </aside>

        {tabletDrawer && (
          <div className="absolute inset-0 z-30 hidden md:flex desk:hidden" data-testid="tablet-drawer">
            <div
              className="flex-1 bg-black/30"
              aria-hidden="true"
              onClick={() => setTabletDrawer(null)}
            />
            <aside
              role="region"
              aria-label={tabletDrawer === "outline" ? "Outline drawer" : "Explanation and study assistant drawer"}
              className="animate-slide-in-right flex h-full w-80 max-w-[85vw] flex-col border-l border-stone-200 bg-surface shadow-xl"
            >
              <div className="flex items-center justify-between border-b border-stone-200 px-4 py-2.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-stone-600">
                  {tabletDrawer === "outline" ? "Outline" : renderAssistantPanel ? "Notes & Study Assistant" : "Explanation"}
                </span>
                <button
                  type="button"
                  onClick={() => setTabletDrawer(null)}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md p-1.5 text-stone-600 hover:bg-stone-100 hover:text-stone-900"
                  aria-label="Close panel drawer"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                {tabletDrawer === "outline" ? (
                  plan ? (
                    <OutlinePanel
                      plan={plan}
                      warnings={warnings}
                      drawnSectionIds={drawnSectionIds}
                      activeSectionId={focus.id}
                      onSelectSection={selectSection}
                      sourceInfo={sourceInfo}
                    />
                  ) : (
                    <p className="text-sm text-stone-600">This note has no outline.</p>
                  )
                ) : (
                  <>
                    {renderAssistantPanel && (
                      <div className="mb-4">
                        <SegmentedControl
                          label="Drawer panel view"
                          size="sm"
                          value={rightTab}
                          onChange={setRightTab}
                          options={[
                            { value: "explanation", label: "Explanation", icon: MessageSquareText },
                            { value: "assistant", label: "Study Assistant", icon: Sparkles },
                          ]}
                        />
                      </div>
                    )}
                    {renderAssistantPanel && rightTab === "assistant" ? (
                      renderAssistantPanel({ onFocusSection: selectSection })
                    ) : plan ? (
                      <ExplanationPanel
                        plan={plan}
                        activeSectionId={focus.id}
                        drawnSectionIds={drawnSectionIds}
                        onSelectSection={selectSection}
                        onRegenerateSection={onRegenerateSection}
                        regeneratingSectionId={regeneratingSectionId}
                      />
                    ) : (
                      <p className="text-sm text-stone-600">No explanation available.</p>
                    )}
                  </>
                )}
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}

/** Phase 2/4 generation result: same workspace plus "Save to library". */
export function VisualWorkspace({ job }) {
  const plan = job.learningPlan;
  const [dirty, setDirty] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const latestScene = useRef(null);

  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  return (
    <>
      <WorkspaceShell
        title={plan.title}
        plan={plan}
        scene={job.sceneJson}
        warnings={job.warnings}
        sourceType={job.inputType ?? "prompt"}
        sourceFile={job.sourceFile ?? null}
        pageRange={job.pageRange ?? null}
        backTo="/app/create"
        backLabel="Back to create"
        onDirtyChange={setDirty}
        onSceneChange={(elements, appState) => {
          latestScene.current = toScenePayload(elements, appState);
        }}
        status={
          <p className="text-xs text-stone-600" role="status" data-testid="edit-status">
            {dirty ? "Edited · not saved" : "Generated · not saved yet"}
          </p>
        }
        actions={
          <Button size="sm" onClick={() => setSaveOpen(true)} data-testid="save-to-library">
            <BookmarkPlus className="h-4 w-4" aria-hidden="true" />
            Save to library
          </Button>
        }
      />
      <SaveToLibraryDialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        job={job}
        getEditedScene={() => (dirty ? latestScene.current : null)}
        onSaved={() => setDirty(false)}
      />
    </>
  );
}
