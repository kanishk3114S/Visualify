import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Modal } from "../../components/Modal.jsx";
import { Button } from "../../components/Button.jsx";
import { FormAlert, TextField } from "../../components/Field.jsx";
import { useToast } from "../../components/Toast.jsx";
import { useFolders, useSaveGeneration } from "../../hooks/useNotes.js";
import { FolderSelect } from "./FolderSelect.jsx";

/**
 * Saves a completed generation as a note (POST /api/v1/notes) - including any
 * edits made on the canvas before saving - then opens it in the editor.
 */
export function SaveToLibraryDialog({ open, onClose, job, getEditedScene, onSaved }) {
  const navigate = useNavigate();
  const toast = useToast();
  const folders = useFolders();
  const save = useSaveGeneration();
  const [title, setTitle] = useState("");
  const [folderId, setFolderId] = useState("");
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setTitle(job.learningPlan?.title ?? "");
      setError(null);
    }
  }, [open, job.learningPlan?.title]);

  function submit(e) {
    e.preventDefault();
    const clean = title.trim();
    if (!clean) {
      setError("Enter a title.");
      return;
    }
    const sceneJson = getEditedScene?.() ?? undefined;
    save.mutate(
      { jobId: job.jobId, title: clean.slice(0, 160), folderId: folderId || null, ...(sceneJson ? { sceneJson } : {}) },
      {
        onSuccess: (data) => {
          onSaved?.();
          toast.success("Saved to your library.");
          navigate(`/app/notes/${data.note.id}/edit`);
        },
        onError: (err) => {
          if (err.code === "JOB_ALREADY_SAVED" && err.details?.noteId) {
            onSaved?.();
            toast.info("This visual is already in your library.");
            navigate(`/app/notes/${err.details.noteId}/edit`);
            return;
          }
          setError(err.requestId ? `${err.message} (Reference: ${err.requestId})` : err.message);
        },
      }
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={save.isPending}
      title="Save to library"
      description="Saved notes keep every edit with autosave and version history."
      testId="save-dialog"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="save-note-form" loading={save.isPending} loadingText="Saving…">
            Save
          </Button>
        </>
      }
    >
      <form id="save-note-form" onSubmit={submit} noValidate className="space-y-4">
        <FormAlert>{error}</FormAlert>
        <TextField label="Title" required maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} />
        <FolderSelect label="Folder" folders={folders.data ?? []} value={folderId} onChange={(e) => setFolderId(e.target.value)} />
      </form>
    </Modal>
  );
}
