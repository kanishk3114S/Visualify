import { useEffect, useState } from "react";
import { Modal } from "../../components/Modal.jsx";
import { Button } from "../../components/Button.jsx";
import { FormAlert, TextField } from "../../components/Field.jsx";
import { useToast } from "../../components/Toast.jsx";
import { useCreateFolder, useFolders, useUpdateFolder, useUpdateNote } from "../../hooks/useNotes.js";
import { descendantIds } from "../../lib/libraryFilters.js";
import { FolderSelect } from "./FolderSelect.jsx";

const errorText = (err) => (err?.requestId ? `${err.message} (Reference: ${err.requestId})` : err?.message);

function footer({ onClose, busy, formId, label }) {
  return (
    <>
      <Button variant="secondary" onClick={onClose} disabled={busy}>
        Cancel
      </Button>
      <Button type="submit" form={formId} loading={busy} loadingText="Saving…">
        {label}
      </Button>
    </>
  );
}

/** Rename a note. */
export function RenameNoteDialog({ note, onClose }) {
  const update = useUpdateNote();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [error, setError] = useState(null);
  useEffect(() => {
    if (note) {
      setTitle(note.title);
      setError(null);
    }
  }, [note]);

  function submit(e) {
    e.preventDefault();
    const clean = title.trim();
    if (!clean) return setError("Enter a title.");
    if (clean.length > 160) return setError("Titles can be at most 160 characters.");
    update.mutate(
      { id: note.id, patch: { title: clean } },
      { onSuccess: () => (toast.success("Note renamed."), onClose()), onError: (err) => setError(errorText(err)) }
    );
  }

  return (
    <Modal open={Boolean(note)} onClose={onClose} busy={update.isPending} title="Rename note" footer={footer({ onClose, busy: update.isPending, formId: "rename-note", label: "Rename" })}>
      <form id="rename-note" onSubmit={submit} noValidate className="space-y-4">
        <FormAlert>{error}</FormAlert>
        <TextField label="Title" required value={title} onChange={(e) => setTitle(e.target.value)} />
      </form>
    </Modal>
  );
}

/** Move a note to a folder (or out of folders). */
export function MoveNoteDialog({ note, onClose }) {
  const update = useUpdateNote();
  const folders = useFolders();
  const toast = useToast();
  const [folderId, setFolderId] = useState("");
  const [error, setError] = useState(null);
  useEffect(() => {
    if (note) {
      setFolderId(note.folderId ?? "");
      setError(null);
    }
  }, [note]);

  function submit(e) {
    e.preventDefault();
    update.mutate(
      { id: note.id, patch: { folderId: folderId || null } },
      {
        onSuccess: () => {
          const name = folders.data?.find((f) => f.id === folderId)?.name;
          toast.success(name ? `Moved to ${name}.` : "Moved out of folders.");
          onClose();
        },
        onError: (err) => setError(errorText(err)),
      }
    );
  }

  return (
    <Modal open={Boolean(note)} onClose={onClose} busy={update.isPending} title="Move note" description={note?.title} footer={footer({ onClose, busy: update.isPending, formId: "move-note", label: "Move" })}>
      <form id="move-note" onSubmit={submit} noValidate className="space-y-4">
        <FormAlert>{error}</FormAlert>
        <FolderSelect label="Folder" folders={folders.data ?? []} value={folderId} onChange={(e) => setFolderId(e.target.value)} />
      </form>
    </Modal>
  );
}

/**
 * Create a folder (folder = null) or rename/move an existing one. A folder can't
 * be moved into itself or its descendants (filtered here, enforced by the API).
 */
export function FolderDialog({ open, folder = null, defaultParentId = "", onClose, onSaved }) {
  const folders = useFolders();
  const create = useCreateFolder();
  const update = useUpdateFolder();
  const toast = useToast();
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [error, setError] = useState(null);
  const busy = create.isPending || update.isPending;

  useEffect(() => {
    if (open) {
      setName(folder?.name ?? "");
      setParentId(folder ? folder.parentId ?? "" : defaultParentId ?? "");
      setError(null);
    }
  }, [open, folder, defaultParentId]);

  function submit(e) {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) return setError("Enter a folder name.");
    if (clean.length > 80) return setError("Folder names can be at most 80 characters.");
    const onError = (err) => setError(errorText(err));
    if (folder) {
      const patch = {};
      if (clean !== folder.name) patch.name = clean;
      if ((parentId || null) !== (folder.parentId ?? null)) patch.parentId = parentId || null;
      if (!Object.keys(patch).length) return onClose();
      update.mutate({ id: folder.id, patch }, { onSuccess: (f) => (toast.success("Folder updated."), onSaved?.(f), onClose()), onError });
    } else {
      create.mutate({ name: clean, parentId: parentId || null }, { onSuccess: (f) => (toast.success("Folder created."), onSaved?.(f), onClose()), onError });
    }
  }

  const exclude = folder ? descendantIds(folders.data ?? [], folder.id) : new Set();
  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      title={folder ? "Edit folder" : "New folder"}
      testId="folder-dialog"
      footer={footer({ onClose, busy, formId: "folder-form", label: folder ? "Save" : "Create" })}
    >
      <form id="folder-form" onSubmit={submit} noValidate className="space-y-4">
        <FormAlert>{error}</FormAlert>
        <TextField label="Folder name" required value={name} onChange={(e) => setName(e.target.value)} />
        <FolderSelect label="Inside" rootLabel="Top level" folders={folders.data ?? []} exclude={exclude} value={parentId} onChange={(e) => setParentId(e.target.value)} />
      </form>
    </Modal>
  );
}
