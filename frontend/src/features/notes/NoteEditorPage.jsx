import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useBlocker, useParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Cloud, CloudOff, Download, History, Loader2, Play, Save } from "lucide-react";
import clsx from "clsx";
import { Button, ButtonLink } from "../../components/Button.jsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.jsx";
import { Modal } from "../../components/Modal.jsx";
import { FormAlert, TextField } from "../../components/Field.jsx";
import { Spinner } from "../../components/Spinner.jsx";
import { useToast } from "../../components/Toast.jsx";
import { useAutosave } from "../../hooks/useAutosave.js";
import {
  useExplainSelection,
  useNote,
  useRegenerateSection,
  useRestoreVersion,
  useSnapshot,
} from "../../hooks/useNotes.js";
import { notesApi } from "../../lib/apiClient.js";
import { statusLabel, toScenePayload } from "../../lib/autosave.js";
import { buildSelectedContext, extractSceneFrames } from "../../lib/frames.js";
import { WorkspaceShell } from "../generation/VisualWorkspace.jsx";
import { ExportDialog } from "./ExportDialog.jsx";
import { VersionHistory } from "./VersionHistory.jsx";
import { NoteLoadError } from "./NoteLoadError.jsx";
import { StudyAssistantPanel } from "./study/StudyAssistantPanel.jsx";

function AutosaveStatus({ state }) {
  const icons = { saved: CheckCircle2, pending: Cloud, saving: Loader2, error: CloudOff, conflict: AlertTriangle };
  const Icon = icons[state.status] ?? Cloud;
  return (
    <p
      role="status"
      aria-live="polite"
      data-testid="save-status"
      data-status={state.status}
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors duration-150",
        state.status === "error" || state.status === "conflict"
          ? "bg-red-50 text-red-700"
          : state.status === "saved"
            ? "bg-accent-50 text-accent-800"
            : "bg-stone-100 text-stone-700"
      )}
    >
      <Icon className={clsx("h-4 w-4", state.status === "saving" && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
      {statusLabel(state)}
    </p>
  );
}

function SnapshotDialog({ open, onClose, onSubmit, busy }) {
  const [description, setDescription] = useState("");
  useEffect(() => {
    if (open) setDescription("");
  }, [open]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      title="Save a snapshot"
      description="Snapshots are permanent versions you can preview and restore later."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="snapshot-form" loading={busy} loadingText="Saving…">
            Save snapshot
          </Button>
        </>
      }
    >
      <form
        id="snapshot-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(description.trim().slice(0, 200));
        }}
      >
        <TextField label="Description (optional)" maxLength={200} placeholder="e.g. Added the UDP comparison" value={description} onChange={(e) => setDescription(e.target.value)} />
      </form>
    </Modal>
  );
}

/** Persistent editor for a saved note: autosave, snapshots, history, exports. */
function NoteEditor({ detail, refetch }) {
  const note = detail.note;
  const toast = useToast();
  const snapshot = useSnapshot();
  const restore = useRestoreVersion();
  const explain = useExplainSelection();
  const regenerate = useRegenerateSection();
  const [canvas, setCanvas] = useState({ key: 0, scene: detail.sceneJson });
  const [plan, setPlan] = useState(detail.currentVersion?.learningPlan ?? null);
  const [panel, setPanel] = useState(null); // "snapshot" | "history" | "export"
  const [selected, setSelected] = useState({ elements: [], allElements: [] });
  const [lastExplain, setLastExplain] = useState(null);
  const [regenId, setRegenId] = useState(null);
  const apiRef = useRef(null);
  const frames = useMemo(() => extractSceneFrames(canvas.scene, plan), [canvas.scene, plan]);

  const save = useCallback(
    (payload, baseRevision) => notesApi.saveDraft(note.id, { sceneJson: payload, baseRevision }),
    [note.id]
  );
  const autosave = useAutosave({ save, initialRevision: detail.draftRevision });
  const { reset } = autosave;

  useEffect(() => {
    reset(detail.draftRevision, detail.draft?.updatedAt ?? detail.currentVersion?.createdAt ?? null);
    // Only on first load of this note; later server data is applied explicitly.
  }, []);

  /** The scene exactly as the user sees it now. */
  const currentScene = () => {
    const api = apiRef.current;
    return api ? toScenePayload(api.getSceneElements(), api.getAppState()) : canvas.scene;
  };

  // Unsaved-changes protection: browser close/refresh...
  useEffect(() => {
    if (!autosave.unsaved) return undefined;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [autosave.unsaved]);

  // ...and in-app navigation: try to save first, ask only if that fails.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => autosave.isDirty() && currentLocation.pathname !== nextLocation.pathname);
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    let cancelled = false;
    autosave
      .flush()
      .then((outcome) => {
        if (cancelled) return;
        if (outcome === "saved" && !autosave.isDirty()) blocker.proceed();
        else setLeaveConfirm(true);
      })
      .catch(() => !cancelled && setLeaveConfirm(true));
    return () => {
      cancelled = true;
    };
  }, [blocker.state]);

  async function takeSnapshot(description) {
    await autosave.pause();
    snapshot.mutate(
      { id: note.id, sceneJson: currentScene(), description },
      {
        onSuccess: (data) => {
          autosave.reset(0);
          setPanel(null);
          toast.success(`Saved as version ${data.version.versionNumber}.`);
        },
        onError: (err) => {
          autosave.resume();
          toast.error(err.message);
        },
      }
    );
  }

  async function restoreVersion(version) {
    await autosave.pause();
    try {
      const data = await restore.mutateAsync({ id: note.id, versionId: version.id });
      setCanvas((c) => ({ key: c.key + 1, scene: data.sceneJson }));
      if (data.learningPlan) setPlan(data.learningPlan);
      autosave.reset(0);
      setPanel(null);
      toast.success(`Restored version ${version.versionNumber} as version ${data.version.versionNumber}.`);
    } catch (err) {
      autosave.resume();
      toast.error(err.message);
    }
  }

  function handleQuickExplain() {
    const selectedCtx = buildSelectedContext(selected.elements, selected.allElements);
    if (selectedCtx.length === 0) return;
    explain.mutate(
      { id: note.id, selectedElements: selectedCtx },
      {
        onSuccess: (res) => setLastExplain(res),
        onError: (err) => toast.error(err.message),
      }
    );
  }

  async function handleRegenerateSection(sectionId, fields) {
    setRegenId(sectionId);
    await autosave.pause();
    try {
      const res = await regenerate.mutateAsync({ id: note.id, sectionId, ...fields });
      setCanvas((c) => ({ key: c.key + 1, scene: res.sceneJson }));
      if (res.learningPlan) setPlan(res.learningPlan);
      autosave.reset(0);
      toast.success(`Regenerated section as version ${res.version.versionNumber}.`);
      return true;
    } catch (err) {
      autosave.resume();
      toast.error(err.message);
      return false;
    } finally {
      setRegenId(null);
    }
  }

  async function reloadLatest() {
    const { data } = await refetch();
    if (!data) return;
    setCanvas((c) => ({ key: c.key + 1, scene: data.sceneJson }));
    autosave.reset(data.draftRevision, data.draft?.updatedAt);
    toast.info("Loaded the latest saved version.");
  }

  async function keepMine() {
    const { data } = await refetch();
    if (!data) return;
    await autosave.retry(data.draftRevision);
  }

  const status = autosave.state.status;
  return (
    <>
      <WorkspaceShell
        title={note.title}
        plan={plan}
        scene={canvas.scene}
        sourceType={note.sourceType ?? "prompt"}
        sourceFile={detail.sourceFile ?? null}
        canvasKey={canvas.key}
        backTo={`/app/notes/${note.id}`}
        backLabel="Back to note"
        onCanvasReady={(api) => {
          apiRef.current = api;
        }}
        onSceneChange={(elements, appState) => autosave.change(() => toScenePayload(elements, appState))}
        onSelectionChange={(elements, allElements) => setSelected({ elements, allElements })}
        selectedCount={buildSelectedContext(selected.elements, selected.allElements).length}
        onExplainSelection={handleQuickExplain}
        explainPending={explain.isPending}
        onRegenerateSection={handleRegenerateSection}
        regeneratingSectionId={regenId}
        renderAssistantPanel={({ onFocusSection }) => (
          <StudyAssistantPanel
            noteId={note.id}
            selectedElements={selected.elements}
            allElements={selected.allElements}
            lastExplain={lastExplain}
            onExplainResult={setLastExplain}
            onFocusSection={onFocusSection}
          />
        )}
        status={<AutosaveStatus state={autosave.state} />}
        actions={
          <>
            <ButtonLink size="sm" variant="secondary" to={`/app/notes/${note.id}/present`} data-testid="editor-present-button">
              <Play className="h-4 w-4" aria-hidden="true" />
              Present
            </ButtonLink>
            <Button size="sm" variant="secondary" onClick={() => setPanel("snapshot")} data-testid="snapshot-button">
              <Save className="h-4 w-4" aria-hidden="true" />
              Snapshot
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setPanel("history")} data-testid="history-button">
              <History className="h-4 w-4" aria-hidden="true" />
              History
            </Button>
            <Button size="sm" onClick={() => setPanel("export")} data-testid="export-button">
              <Download className="h-4 w-4" aria-hidden="true" />
              Export
            </Button>
          </>
        }
      />

      {(status === "error" || status === "conflict") && (
        <div role="alert" className="fixed bottom-4 left-1/2 z-30 flex w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 flex-col gap-3 rounded-lg border border-red-200 bg-surface p-4 shadow-lg sm:flex-row sm:items-center" data-testid="save-problem">
          <p className="flex-1 text-sm text-stone-800">
            {status === "conflict"
              ? "This note was changed in another tab or window. Choose which version to keep."
              : `Your latest changes aren't saved. ${autosave.state.error?.message ?? ""}`}
          </p>
          <div className="flex gap-2">
            {status === "conflict" ? (
              <>
                <Button size="sm" variant="secondary" onClick={reloadLatest}>
                  Load latest
                </Button>
                <Button size="sm" onClick={keepMine}>
                  Keep mine
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => autosave.retry()}>
                Retry
              </Button>
            )}
          </div>
        </div>
      )}

      <SnapshotDialog open={panel === "snapshot"} busy={snapshot.isPending} onClose={() => setPanel(null)} onSubmit={takeSnapshot} />
      <VersionHistory noteId={note.id} open={panel === "history"} onClose={() => setPanel(null)} onRestore={restoreVersion} restoring={restore.isPending} />
      <ExportDialog
        open={panel === "export"}
        onClose={() => setPanel(null)}
        note={note}
        frames={frames}
        selectedElements={selected.elements}
        beforeExport={async () => {
          if ((await autosave.flush()) !== "saved") throw new Error("unsaved");
        }}
      />
      <ConfirmDialog
        open={leaveConfirm}
        title="Leave without saving?"
        description="Your latest changes couldn't be saved. If you leave now they will be lost."
        confirmLabel="Leave anyway"
        cancelLabel="Stay"
        onCancel={() => {
          setLeaveConfirm(false);
          blocker.reset?.();
        }}
        onConfirm={() => {
          setLeaveConfirm(false);
          blocker.proceed?.();
        }}
      />
    </>
  );
}

export function NoteEditorPage() {
  const { noteId } = useParams();
  const query = useNote(noteId);
  if (query.isPending) {
    return (
      <div className="flex items-center justify-center gap-3 py-24 text-stone-600">
        <Spinner label="Loading note" className="text-accent-700" />
        <span aria-hidden="true">Loading note…</span>
      </div>
    );
  }
  if (query.isError) return <NoteLoadError error={query.error} onRetry={query.refetch} />;
  if (!query.data.sceneJson) {
    return (
      <div className="px-4 py-10">
        <FormAlert>This note has no saved scene yet.</FormAlert>
        <Link to="/app/notes" className="mt-4 inline-block text-sm text-accent-700 underline">
          Back to library
        </Link>
      </div>
    );
  }
  return <NoteEditor key={noteId} detail={query.data} refetch={query.refetch} />;
}
