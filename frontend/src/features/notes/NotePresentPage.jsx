import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import clsx from "clsx";
import { ArrowLeft, ChevronLeft, ChevronRight, Maximize2, MessageSquareText, Minimize2, PanelRightClose, PanelRightOpen } from "lucide-react";
import { Button } from "../../components/Button.jsx";
import { Badge } from "../../components/Layout.jsx";
import { Spinner } from "../../components/Spinner.jsx";
import { useNote } from "../../hooks/useNotes.js";
import { extractSceneFrames } from "../../lib/frames.js";
import { SourceRefChips, VISUAL_TYPE_LABELS } from "../generation/VisualWorkspace.jsx";
import { NoteLoadError } from "./NoteLoadError.jsx";

const WorkspaceCanvas = lazy(() => import("../generation/WorkspaceCanvas.jsx"));

export function NotePresentPage() {
  const { noteId } = useParams();
  const navigate = useNavigate();
  const query = useNote(noteId);
  const rootRef = useRef(null);
  const [slideIdx, setSlideIdx] = useState(0);
  const [focusNonce, setFocusNonce] = useState(1);
  const [notesOpen, setNotesOpen] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const plan = query.data?.currentVersion?.learningPlan ?? null;
  const sceneJson = query.data?.sceneJson ?? null;
  const frames = useMemo(() => extractSceneFrames(sceneJson, plan), [sceneJson, plan]);
  const total = frames.length;
  const safeIdx = total > 0 ? Math.min(slideIdx, total - 1) : 0;
  const currentFrame = frames[safeIdx] ?? null;
  const activeSection = currentFrame?.sectionId
    ? (plan?.sections ?? []).find((s) => s.id === currentFrame.sectionId) ?? null
    : null;

  function go(nextIdx) {
    if (total === 0) return;
    const bounded = Math.max(0, Math.min(total - 1, nextIdx));
    setSlideIdx(bounded);
    setFocusNonce((n) => n + 1);
  }

  function toggleFullscreen() {
    if (!document.fullscreenEnabled) return;
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else rootRef.current?.requestFullscreen?.().catch(() => {});
  }

  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowRight" || e.key === "PageDown" || (e.key === " " && tag !== "BUTTON")) {
        e.preventDefault();
        go(safeIdx + 1);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        go(safeIdx - 1);
      } else if (e.key === "Escape") {
        if (!document.fullscreenElement) navigate(`/app/notes/${noteId}`);
      } else if (e.key === "n" || e.key === "N") {
        setNotesOpen((v) => !v);
      } else if (e.key === "f" || e.key === "F") {
        toggleFullscreen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [safeIdx, total, noteId, navigate]);

  if (query.isPending) {
    return (
      <div className="flex items-center justify-center gap-3 py-24 text-stone-600">
        <Spinner label="Loading presentation" className="text-accent-700" />
        <span aria-hidden="true">Loading presentation…</span>
      </div>
    );
  }
  if (query.isError) return <NoteLoadError error={query.error} onRetry={query.refetch} />;

  const note = query.data.note;

  return (
    <div ref={rootRef} className="flex h-[calc(100dvh-3.5rem)] flex-col bg-canvas lg:h-dvh" data-testid="present-view">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 bg-surface px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            to={`/app/notes/${noteId}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-surface px-2.5 py-1 text-xs font-medium text-stone-800 hover:bg-stone-100"
            data-testid="present-exit"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Exit
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-stone-900">{note.title}</h1>
            <p className="text-xs tabular-nums text-stone-600" data-testid="slide-counter">
              {total > 0 ? `Slide ${safeIdx + 1} of ${total}${currentFrame?.title ? ` · ${currentFrame.title}` : ""}` : "No slides"}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" disabled={safeIdx <= 0} onClick={() => go(safeIdx - 1)} data-testid="present-prev">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Previous
          </Button>
          <Button size="sm" variant="secondary" disabled={safeIdx >= total - 1} onClick={() => go(safeIdx + 1)} data-testid="present-next">
            Next
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setNotesOpen((v) => !v)}
            aria-pressed={notesOpen}
            aria-label={notesOpen ? "Hide speaker notes" : "Show speaker notes"}
            data-testid="present-notes-toggle"
          >
            {notesOpen ? <PanelRightClose className="h-4 w-4" aria-hidden="true" /> : <PanelRightOpen className="h-4 w-4" aria-hidden="true" />}
            Notes
          </Button>
          <Button size="sm" variant="ghost" onClick={toggleFullscreen} aria-label="Toggle fullscreen">
            {isFullscreen ? <Minimize2 className="h-4 w-4" aria-hidden="true" /> : <Maximize2 className="h-4 w-4" aria-hidden="true" />}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative min-h-[20rem] flex-1">
          {sceneJson ? (
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center gap-2 text-stone-600">
                  <Spinner label="Loading slide" className="text-accent-700" />
                  <span aria-hidden="true">Loading slide…</span>
                </div>
              }
            >
              <div className="absolute inset-0">
                <WorkspaceCanvas
                  key={query.data.currentVersion?.id ?? "present"}
                  scene={sceneJson}
                  focusElementIds={currentFrame?.elementIds}
                  focusSectionId={currentFrame?.sectionId}
                  focusNonce={focusNonce}
                  viewMode
                />
              </div>
            </Suspense>
          ) : (
            <p className="p-6 text-sm text-stone-600">No diagram available.</p>
          )}
        </div>

        {notesOpen && (
          <aside
            aria-label="Speaker notes"
            data-testid="present-notes-drawer"
            className="max-h-72 overflow-y-auto border-t border-stone-200 bg-surface p-4 lg:max-h-none lg:w-80 lg:border-l lg:border-t-0"
          >
            <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">
              <MessageSquareText className="h-3.5 w-3.5" aria-hidden="true" />
              Speaker notes
            </h2>
            {activeSection ? (
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-stone-900">{activeSection.title}</h3>
                  <Badge tone="accent">{VISUAL_TYPE_LABELS[activeSection.visualType] ?? activeSection.visualType}</Badge>
                </div>
                <p className="whitespace-pre-line text-sm leading-relaxed text-stone-700">{activeSection.explanation}</p>
                <SourceRefChips refs={activeSection.sourceRefs} />
                {activeSection.keyConcepts?.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5" aria-label="Slide key concepts">
                    {activeSection.keyConcepts.map((c) => (
                      <li key={c}>
                        <Badge>{c}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="mt-3 text-sm text-stone-600">{plan?.summary ?? "Use arrow keys or Space to advance slides."}</p>
            )}
          </aside>
        )}
      </div>

      {total > 1 && (
        <nav aria-label="Slide selector" className="flex flex-wrap items-center gap-1.5 border-t border-stone-200 bg-surface px-4 py-2">
          {frames.map((f, idx) => (
            <button
              key={`${f.frameId ?? f.sectionId ?? idx}`}
              type="button"
              onClick={() => go(idx)}
              aria-current={idx === safeIdx ? "true" : undefined}
              className={clsx(
                "max-w-xs truncate rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                idx === safeIdx
                  ? "border-accent-700 bg-accent-50 text-accent-900"
                  : "border-stone-200 bg-canvas text-stone-700 hover:border-stone-300 hover:text-stone-900"
              )}
            >
              {f.title}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
