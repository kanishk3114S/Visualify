import { lazy, Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Eye, History, RotateCcw, X } from "lucide-react";
import { Button } from "../../components/Button.jsx";
import { Badge } from "../../components/Layout.jsx";
import { Modal } from "../../components/Modal.jsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.jsx";
import { Spinner } from "../../components/Spinner.jsx";
import { useVersions } from "../../hooks/useNotes.js";
import { notesApi } from "../../lib/apiClient.js";
import { formatDateTime } from "../../lib/format.js";

const WorkspaceCanvas = lazy(() => import("../generation/WorkspaceCanvas.jsx"));

const KIND_LABELS = {
  generated: "Generated",
  snapshot: "Snapshot",
  draft: "Autosaved edits",
  restore: "Restored",
  duplicate: "Duplicated",
};

function VersionPreview({ noteId, version, onClose, onRestore, canRestore }) {
  const detail = useQuery({
    queryKey: ["version-preview", noteId, version?.id],
    queryFn: ({ signal }) => notesApi.version(noteId, version.id, { signal }),
    enabled: Boolean(version),
  });
  return (
    <Modal
      open={Boolean(version)}
      onClose={onClose}
      size="lg"
      title={version ? `Version ${version.versionNumber}` : ""}
      description={version ? `${KIND_LABELS[version.kind] ?? version.kind} · ${formatDateTime(version.createdAt)}` : ""}
      testId="version-preview"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {canRestore && version && !version.isCurrent && (
            <Button onClick={() => onRestore(version)}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Restore this version
            </Button>
          )}
        </>
      }
    >
      <div className="relative h-[55vh] min-h-[18rem] overflow-hidden rounded-lg border border-stone-200">
        {detail.isPending && (
          <div className="flex h-full items-center justify-center">
            <Spinner label="Loading version" className="text-accent-700" />
          </div>
        )}
        {detail.isError && <p className="p-4 text-sm text-red-700">This version couldn't be loaded.</p>}
        {detail.data && (
          <Suspense fallback={<div className="flex h-full items-center justify-center"><Spinner label="Loading canvas" /></div>}>
            <div className="absolute inset-0">
              <WorkspaceCanvas scene={detail.data.sceneJson} viewMode />
            </div>
          </Suspense>
        )}
      </div>
    </Modal>
  );
}

/**
 * Version history panel (FR-LIB-07): newest first, preview any version, and
 * restore it as a NEW current version (history is never overwritten).
 */
export function VersionHistory({ noteId, open, onClose, onRestore, restoring = false, canRestore = true }) {
  const versions = useVersions(noteId, { enabled: open });
  const [preview, setPreview] = useState(null);
  const [confirm, setConfirm] = useState(null);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="fixed inset-0 bg-black/35" aria-hidden="true" onClick={onClose} />
      <aside
        className="animate-slide-in-right relative z-10 flex h-full w-full max-w-sm flex-col border-l border-stone-200 bg-surface shadow-xl"
        aria-labelledby="history-title"
        data-testid="version-history"
      >
      <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
        <h2 id="history-title" className="flex items-center gap-2 text-base font-semibold text-stone-900">
          <History className="h-4 w-4" aria-hidden="true" />
          Version history
        </h2>
        <button type="button" onClick={onClose} className="rounded-md p-1.5 text-stone-500 hover:bg-stone-100 hover:text-stone-900" aria-label="Close version history">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {versions.isPending && <Spinner label="Loading versions" className="text-accent-700" />}
        {versions.isError && <p className="text-sm text-red-700">Version history couldn't be loaded.</p>}
        <ol className="space-y-2">
          {versions.data?.map((v) => (
            <li key={v.id} className="rounded-lg border border-stone-200 p-3" data-testid="version-item">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-stone-900">
                    Version {v.versionNumber}{" "}
                    {v.isCurrent && (
                      <Badge tone="accent">
                        Current
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs text-stone-600">
                    {KIND_LABELS[v.kind] ?? v.kind} · <time dateTime={v.createdAt}>{formatDateTime(v.createdAt)}</time>
                  </p>
                  {v.description && <p className="mt-1 break-words text-sm text-stone-700">{v.description}</p>}
                </div>
              </div>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setPreview(v)} aria-label={`Preview version ${v.versionNumber}`}>
                  <Eye className="h-4 w-4" aria-hidden="true" />
                  Preview
                </Button>
                {canRestore && !v.isCurrent && (
                  <Button size="sm" variant="secondary" onClick={() => setConfirm(v)} disabled={restoring} aria-label={`Restore version ${v.versionNumber}`}>
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    Restore
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
      <VersionPreview
        noteId={noteId}
        version={preview}
        canRestore={canRestore}
        onClose={() => setPreview(null)}
        onRestore={(v) => {
          setPreview(null);
          setConfirm(v);
        }}
      />
      <ConfirmDialog
        open={Boolean(confirm)}
        tone="primary"
        title={confirm ? `Restore version ${confirm.versionNumber}?` : ""}
        description="It becomes a new current version. Your current work is kept in history first, so nothing is lost."
        confirmLabel="Restore"
        loading={restoring}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          await onRestore(confirm);
          setConfirm(null);
        }}
      />
    </aside>
    </div>
  );
}
