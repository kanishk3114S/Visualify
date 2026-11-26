import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, BookOpen, CheckSquare, ChevronDown, Crosshair, Download, FileText, HelpCircle, History, Image as ImageIcon, Layers, MessageSquare, Pencil, Play, Presentation, Square, Star } from "lucide-react";
import clsx from "clsx";
import { Button, ButtonLink } from "../../components/Button.jsx";
import { Badge, Card } from "../../components/Layout.jsx";
import { SegmentedControl } from "../../components/SegmentedControl.jsx";
import { Spinner } from "../../components/Spinner.jsx";
import { useToast } from "../../components/Toast.jsx";
import { useFolders, useNote, useNoteStudy, useRestoreVersion, useUpdateNote } from "../../hooks/useNotes.js";
import { formatDateTime } from "../../lib/format.js";
import { extractSceneFrames } from "../../lib/frames.js";
import { SourceRefChips, VISUAL_TYPE_LABELS, drawnSections } from "../generation/VisualWorkspace.jsx";
import { ExportDialog } from "./ExportDialog.jsx";
import { VersionHistory } from "./VersionHistory.jsx";
import { NoteLoadError } from "./NoteLoadError.jsx";
import { Collapse } from "../../motion/Collapse.jsx";
import { QuizView } from "./study/QuizView.jsx";
import { FlashcardsView } from "./study/FlashcardsView.jsx";
import { RevisionSheetView } from "./study/RevisionSheetView.jsx";
import { AskNoteView } from "./study/AskNoteView.jsx";

const WorkspaceCanvas = lazy(() => import("../generation/WorkspaceCanvas.jsx"));

function readChecklist(noteId) {
  try {
    const raw = window.localStorage.getItem(`visualify:study:${noteId}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeChecklist(noteId, checked) {
  try {
    window.localStorage.setItem(`visualify:study:${noteId}`, JSON.stringify(checked));
  } catch {
    /* ignore storage limits */
  }
}

/** Read/study view of a saved note (PRD 7: /app/notes/:noteId). */
export function NoteReadPage() {
  const { noteId } = useParams();
  const query = useNote(noteId);
  const studyQuery = useNoteStudy(noteId, { enabled: Boolean(query.data?.note?.id) });
  const folders = useFolders();
  const update = useUpdateNote();
  const restore = useRestoreVersion();
  const toast = useToast();
  const [panel, setPanel] = useState(null);
  const [view, setView] = useState("overview"); // "overview" | "quiz" | "flashcards" | "revision" | "ask"
  const [focus, setFocus] = useState({ id: null, nonce: 0 });
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [checked, setChecked] = useState(() => readChecklist(noteId));
  const canvasWrapRef = useRef(null);

  useEffect(() => {
    setChecked(readChecklist(noteId));
    setView("overview");
  }, [noteId]);

  const plan = query.data?.currentVersion?.learningPlan ?? null;
  const sceneJson = query.data?.sceneJson ?? null;
  const frames = useMemo(() => extractSceneFrames(sceneJson, plan), [sceneJson, plan]);
  const drawn = useMemo(() => drawnSections(plan, sceneJson), [plan, sceneJson]);
  const allConcepts = useMemo(
    () => (plan?.sections ? [...new Set(plan.sections.flatMap((s) => s.keyConcepts ?? []))] : []),
    [plan]
  );

  if (query.isPending) {
    return (
      <div className="flex items-center justify-center gap-3 py-24 text-stone-600">
        <Spinner label="Loading note" className="text-accent-700" />
        <span aria-hidden="true">Loading note…</span>
      </div>
    );
  }
  if (query.isError) return <NoteLoadError error={query.error} onRetry={query.refetch} />;

  const { note, currentVersion, sourceFile } = query.data;
  const folder = folders.data?.find((f) => f.id === note.folderId);

  function toggleFavorite() {
    update.mutate(
      { id: note.id, patch: { isFavorite: !note.isFavorite } },
      { onError: (err) => toast.error(err.message) }
    );
  }

  function toggleConcept(concept) {
    setChecked((prev) => {
      const next = { ...prev, [concept]: !prev[concept] };
      writeChecklist(note.id, next);
      return next;
    });
  }

  function focusSectionOnCanvas(sectionId) {
    setView("overview");
    setFocus((f) => ({ id: sectionId, nonce: f.nonce + 1 }));
    requestAnimationFrame(() => canvasWrapRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" }));
  }

  const reviewedCount = allConcepts.filter((c) => checked[c]).length;

  return (
    <article className="space-y-6" aria-labelledby="note-title">
      <Link to={folder ? `/app/folders/${folder.id}` : "/app/notes"} className="inline-flex items-center gap-1.5 text-sm text-stone-600 hover:text-stone-900">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {folder ? folder.name : "Library"}
      </Link>

      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 id="note-title" className="text-2xl font-semibold tracking-tight text-stone-900" data-testid="note-title">
              {note.title}
            </h1>
            {note.sourceType && note.sourceType !== "prompt" && (
              <Badge tone="accent">
                {note.sourceType === "pdf" ? <FileText className="h-3 w-3" aria-hidden="true" /> : <ImageIcon className="h-3 w-3" aria-hidden="true" />}
                {note.sourceType === "pdf" ? "PDF" : "Image"}
              </Badge>
            )}
          </div>
          <p className="text-sm text-stone-600">
            {note.subject && <span>{note.subject} · </span>}
            Updated <time dateTime={note.updatedAt}>{formatDateTime(note.updatedAt)}</time>
            {currentVersion && <span> · Version {currentVersion.versionNumber}</span>}
            {note.isArchived && <span> · Archived</span>}
          </p>
          {note.tags.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
              {note.tags.map((t) => (
                <li key={t}>
                  <Badge>#{t}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={toggleFavorite}
            aria-pressed={note.isFavorite}
            aria-label={note.isFavorite ? "Remove from favorites" : "Add to favorites"}
          >
            <Star className={clsx("h-4 w-4", note.isFavorite && "fill-current text-amber-800")} aria-hidden="true" />
            {note.isFavorite ? "Favorited" : "Favorite"}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setPanel("history")}>
            <History className="h-4 w-4" aria-hidden="true" />
            History
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setPanel("export")}>
            <Download className="h-4 w-4" aria-hidden="true" />
            Export
          </Button>
          <ButtonLink to={`/app/notes/${note.id}/present`} variant="secondary" size="sm" data-testid="present-note">
            <Play className="h-4 w-4" aria-hidden="true" />
            Present
          </ButtonLink>
          <ButtonLink to={`/app/notes/${note.id}/edit`} size="sm" data-testid="edit-note">
            <Pencil className="h-4 w-4" aria-hidden="true" />
            Edit
          </ButtonLink>
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl
          label="Study mode"
          testId="note-study-tabs"
          value={view}
          onChange={setView}
          options={[
            { value: "overview", label: "Overview & Diagram", icon: Presentation },
            { value: "quiz", label: "Quick Quiz", icon: HelpCircle },
            { value: "flashcards", label: "Flashcards", icon: Layers },
            { value: "revision", label: "Revision Sheet", icon: BookOpen },
            { value: "ask", label: "Ask This Note", icon: MessageSquare },
          ]}
        />
      </div>

      {view === "quiz" && (
        <QuizView
          noteId={note.id}
          quiz={studyQuery.data?.quiz ?? null}
          onFocusSection={focusSectionOnCanvas}
        />
      )}

      {view === "flashcards" && (
        <FlashcardsView
          noteId={note.id}
          flashcards={studyQuery.data?.flashcards ?? []}
        />
      )}

      {view === "revision" && (
        <RevisionSheetView
          noteId={note.id}
          revisionGuide={studyQuery.data?.revisionGuide ?? null}
        />
      )}

      {view === "ask" && (
        <AskNoteView
          noteId={note.id}
          onFocusSection={focusSectionOnCanvas}
        />
      )}

      {view === "overview" && (
        <>
          {sourceFile && (
        <Card className="p-4" data-testid="note-source-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm text-stone-800">
              {sourceFile.mimeType === "application/pdf" ? (
                <FileText className="h-4 w-4 text-accent-700" aria-hidden="true" />
              ) : (
                <ImageIcon className="h-4 w-4 text-accent-700" aria-hidden="true" />
              )}
              <span className="font-medium">{sourceFile.originalName}</span>
              {sourceFile.pageCount && <Badge tone="neutral">{sourceFile.pageCount} pages</Badge>}
            </div>
            {sourceFile.previewUrl && (
              <details>
                <summary className="cursor-pointer text-xs font-medium text-accent-700 hover:text-accent-800">Preview source image</summary>
                <img src={sourceFile.previewUrl} alt={`Source ${sourceFile.originalName}`} className="mt-2 max-h-56 rounded border border-stone-200 object-contain" />
              </details>
            )}
          </div>
        </Card>
      )}

      {plan?.summary && (
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-stone-900">Overview</h2>
          <p className="mt-1 text-sm leading-relaxed text-stone-700">{plan.summary}</p>
          {plan.learningObjectives?.length > 0 && (
            <>
              <h3 className="mt-4 text-sm font-semibold text-stone-900">Learning objectives</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-stone-700">
                {plan.learningObjectives.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}

      {allConcepts.length > 0 && (
        <Card className="overflow-hidden" data-testid="study-checklist">
          <button
            type="button"
            aria-expanded={checklistOpen}
            onClick={() => setChecklistOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-stone-50"
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-stone-900">
              <CheckSquare className="h-4 w-4 text-accent-700" aria-hidden="true" />
              Study checklist
              <Badge tone="accent">
                {reviewedCount} / {allConcepts.length} reviewed
              </Badge>
            </span>
            <ChevronDown className={clsx("h-4 w-4 text-stone-500 transition-transform duration-200", checklistOpen && "rotate-180")} aria-hidden="true" />
          </button>
          <Collapse open={checklistOpen}>
            <div className="border-t border-stone-200 px-5 py-4">
              <ul className="flex flex-wrap gap-2">
                {allConcepts.map((concept) => {
                  const isDone = Boolean(checked[concept]);
                  const Icon = isDone ? CheckSquare : Square;
                  return (
                    <li key={concept}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={isDone}
                        onClick={() => toggleConcept(concept)}
                        className={clsx(
                          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors active:scale-[0.98]",
                          isDone
                            ? "border-accent-700 bg-accent-50 text-accent-900"
                            : "border-stone-300 bg-surface text-stone-700 hover:border-stone-400"
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                        <span className={isDone ? "line-through" : undefined}>{concept}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </Collapse>
        </Card>
      )}

      <Card ref={canvasWrapRef} className="overflow-hidden" aria-label="Diagram">
        <div className="relative h-[60vh] min-h-[20rem]" data-testid="note-read-canvas">
          {sceneJson ? (
            <Suspense fallback={<div className="flex h-full items-center justify-center"><Spinner label="Loading canvas" className="text-accent-700" /></div>}>
              <div className="absolute inset-0">
                <WorkspaceCanvas
                  key={`${currentVersion?.id}-${query.data.draftRevision}`}
                  scene={sceneJson}
                  focusSectionId={focus.id}
                  focusNonce={focus.nonce}
                  viewMode
                />
              </div>
            </Suspense>
          ) : (
            <p className="p-6 text-sm text-stone-600">No diagram saved yet.</p>
          )}
        </div>
      </Card>

      {plan?.sections?.length > 0 && (
        <section aria-labelledby="sections-heading" className="space-y-4">
          <h2 id="sections-heading" className="text-base font-semibold text-stone-900">
            Sections
          </h2>
          {plan.sections.map((s, i) => (
            <Card key={s.id} className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-stone-900">
                    {i + 1}. {s.title}
                  </h3>
                  <Badge tone="accent">{VISUAL_TYPE_LABELS[s.visualType] ?? s.visualType}</Badge>
                </div>
                {drawn.has(s.id) && (
                  <Button size="sm" variant="ghost" onClick={() => focusSectionOnCanvas(s.id)}>
                    <Crosshair className="h-3.5 w-3.5" aria-hidden="true" />
                    Focus on canvas
                  </Button>
                )}
              </div>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-stone-700">{s.explanation}</p>
              <SourceRefChips refs={s.sourceRefs} />
              {s.keyConcepts?.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Key concepts">
                  {s.keyConcepts.map((c) => (
                    <li key={c} className="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs text-stone-700">
                      {c}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </section>
      )}
        </>
      )}

      <VersionHistory
        noteId={note.id}
        open={panel === "history"}
        onClose={() => setPanel(null)}
        restoring={restore.isPending}
        onRestore={async (v) => {
          try {
            const data = await restore.mutateAsync({ id: note.id, versionId: v.id });
            setPanel(null);
            toast.success(`Restored version ${v.versionNumber} as version ${data.version.versionNumber}.`);
          } catch (err) {
            toast.error(err.message);
          }
        }}
      />
      <ExportDialog open={panel === "export"} onClose={() => setPanel(null)} note={note} frames={frames} />
    </article>
  );
}
