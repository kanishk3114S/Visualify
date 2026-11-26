import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, useNavigate, useParams, useSearchParams } from "react-router-dom";
import clsx from "clsx";
import {
  Archive,
  ArchiveRestore,
  Copy,
  FileImage,
  FileText,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  LayoutGrid,
  List,
  Pencil,
  Search,
  Sparkles,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { Badge, Card, PageHeader } from "../../components/Layout.jsx";
import { Button, ButtonLink } from "../../components/Button.jsx";
import { ActionMenu } from "../../components/Menu.jsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.jsx";
import { SelectField } from "../../components/Field.jsx";
import { SegmentedControl } from "../../components/SegmentedControl.jsx";
import { useToast } from "../../components/Toast.jsx";
import { useDeleteFolder, useDeleteNote, useDuplicateNote, useFolders, useNotesList, useUpdateNote } from "../../hooks/useNotes.js";
import {
  SORT_OPTIONS,
  buildFolderTree,
  hasActiveFilters,
  parseLibraryParams,
  toLibrarySearchParams,
} from "../../lib/libraryFilters.js";
import { formatDateTime, formatRelative } from "../../lib/format.js";
import { FolderDialog, MoveNoteDialog, RenameNoteDialog } from "./NoteDialogs.jsx";

// ---------------------------------------------------------------------------
function FolderNav({ folders, activeId, onNewFolder }) {
  const tree = buildFolderTree(folders);
  const linkClass = (active) =>
    clsx("flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm", active ? "bg-accent-50 font-medium text-accent-900" : "text-stone-700 hover:bg-stone-100");
  return (
    <nav aria-label="Folders" className="space-y-1" data-testid="folder-nav">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Folders</h2>
        <button type="button" onClick={onNewFolder} className="rounded-md p-1 text-stone-600 hover:bg-stone-100 hover:text-stone-900" aria-label="New folder" title="New folder">
          <FolderPlus className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <NavLink to="/app/notes" end className={({ isActive }) => linkClass(isActive && !activeId)}>
        <FolderOpen className="h-4 w-4" aria-hidden="true" />
        All notes
      </NavLink>
      <NavLink to="/app/folders/root" className={() => linkClass(activeId === "root")}>
        <Folder className="h-4 w-4" aria-hidden="true" />
        No folder
      </NavLink>
      <ul className="space-y-0.5">
        {tree.map((f) => (
          <li key={f.id}>
            <NavLink to={`/app/folders/${f.id}`} className={() => linkClass(activeId === f.id)} style={{ paddingLeft: `${0.625 + f.depth * 0.875}rem` }}>
              <Folder className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="text-xs tabular-nums text-stone-500" aria-label={`${f.noteCount} notes`}>
                {f.noteCount}
              </span>
            </NavLink>
          </li>
        ))}
      </ul>
      {folders.length === 0 && <p className="px-2.5 text-xs text-stone-500">No folders yet.</p>}
    </nav>
  );
}

// ---------------------------------------------------------------------------
function noteActions(note, act) {
  return [
    { label: "Open", icon: FolderOpen, onSelect: () => act("open", note) },
    { label: "Rename", icon: Pencil, onSelect: () => act("rename", note) },
    { label: "Move to folder", icon: FolderInput, onSelect: () => act("move", note) },
    { label: note.isFavorite ? "Remove favorite" : "Add to favorites", icon: Star, onSelect: () => act("favorite", note) },
    { label: "Duplicate", icon: Copy, onSelect: () => act("duplicate", note) },
    { label: note.isArchived ? "Unarchive" : "Archive", icon: note.isArchived ? ArchiveRestore : Archive, onSelect: () => act("archive", note) },
    { label: "Delete", icon: Trash2, danger: true, onSelect: () => act("delete", note) },
  ];
}

function FavoriteButton({ note, act }) {
  return (
    <button
      type="button"
      onClick={() => act("favorite", note)}
      aria-pressed={note.isFavorite}
      aria-label={note.isFavorite ? `Remove ${note.title} from favorites` : `Add ${note.title} to favorites`}
      className="rounded-md p-1.5 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900 active:scale-90"
    >
      <Star
        className={clsx(
          "h-4 w-4 transition-transform duration-200 ease-[var(--ease-spring)]",
          note.isFavorite ? "scale-110 fill-current text-amber-800" : "scale-100"
        )}
        aria-hidden="true"
      />
    </button>
  );
}

function SourceTypeBadge({ sourceType }) {
  if (!sourceType || sourceType === "prompt") {
    return <Badge tone="neutral">Prompt</Badge>;
  }
  if (sourceType === "pdf") {
    return (
      <Badge tone="accent">
        <FileText className="h-3 w-3" aria-hidden="true" />
        PDF
      </Badge>
    );
  }
  return (
    <Badge tone="accent">
      <ImageIcon className="h-3 w-3" aria-hidden="true" />
      Image
    </Badge>
  );
}

function NoteCard({ note, act, onTag }) {
  return (
    <li className="group flex flex-col overflow-hidden rounded-xl border border-stone-200 bg-surface shadow-xs transition-[transform,box-shadow,border-color] duration-150 ease-[var(--ease-out)] hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-md" data-testid="note-card">
      <Link to={`/app/notes/${note.id}`} viewTransition className="block aspect-[16/10] overflow-hidden border-b border-stone-200 bg-stone-50" tabIndex={-1} aria-hidden="true">
        {note.previewUrl ? (
          <img src={note.previewUrl} alt="" loading="lazy" className="h-full w-full object-contain p-2 transition-transform duration-200 group-hover:scale-[1.02]" referrerPolicy="no-referrer" />
        ) : (
          <span className="flex h-full items-center justify-center text-stone-400">
            <FileImage className="h-8 w-8" aria-hidden="true" />
          </span>
        )}
      </Link>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <div className="flex items-start gap-1">
          <Link to={`/app/notes/${note.id}`} className="min-w-0 flex-1 truncate text-sm font-semibold text-stone-900 hover:underline">
            {note.title}
          </Link>
          <FavoriteButton note={note} act={act} />
          <ActionMenu label={`Actions for ${note.title}`} items={noteActions(note, act)} />
        </div>
        <p className="truncate text-xs text-stone-600">
          {note.subject ? `${note.subject} · ` : ""}Updated <time dateTime={note.updatedAt} title={formatDateTime(note.updatedAt)}>{formatRelative(note.updatedAt)}</time>
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <SourceTypeBadge sourceType={note.sourceType} />
          {note.isArchived && <Badge tone="soon">Archived</Badge>}
          {note.tags.slice(0, 3).map((t) => (
            <button key={t} type="button" onClick={() => onTag(t)} className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-700 hover:bg-stone-200" aria-label={`Filter by tag ${t}`}>
              #{t}
            </button>
          ))}
        </div>
      </div>
    </li>
  );
}

function NoteTable({ notes, act, folders, sort, onSort }) {
  const folderName = (id) => folders.find((f) => f.id === id)?.name ?? "—";
  const SortHeader = ({ column, children }) => (
    <th scope="col" aria-sort={sort === column ? (column === "title" ? "ascending" : "descending") : "none"} className="px-3 py-2 text-left font-medium">
      <button type="button" onClick={() => onSort(column)} className="inline-flex items-center gap-1 hover:text-stone-900">
        {children}
        {sort === column && <span aria-hidden="true">{column === "title" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
  return (
    <div className="overflow-x-auto rounded-xl border border-stone-200 bg-surface">
      <table className="w-full min-w-[40rem] text-sm" data-testid="note-table">
        <thead className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-600">
          <tr>
            <SortHeader column="title">Title</SortHeader>
            <th scope="col" className="px-3 py-2 text-left font-medium">Subject</th>
            <th scope="col" className="px-3 py-2 text-left font-medium">Folder</th>
            <SortHeader column="updated_at">Updated</SortHeader>
            <SortHeader column="last_opened_at">Opened</SortHeader>
            <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {notes.map((n) => (
            <tr key={n.id} className="hover:bg-stone-50" data-testid="note-row">
              <td className="max-w-[18rem] px-3 py-2">
                <div className="flex items-center gap-1.5">
                  {n.isFavorite && <Star className="h-3.5 w-3.5 shrink-0 fill-current text-amber-800" aria-label="Favorite" />}
                  <Link to={`/app/notes/${n.id}`} className="truncate font-medium text-stone-900 hover:underline">
                    {n.title}
                  </Link>
                  <SourceTypeBadge sourceType={n.sourceType} />
                  {n.isArchived && <Badge tone="soon">Archived</Badge>}
                </div>
              </td>
              <td className="px-3 py-2 text-stone-700">{n.subject || "—"}</td>
              <td className="px-3 py-2 text-stone-700">{folderName(n.folderId)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-stone-700"><time dateTime={n.updatedAt} title={formatDateTime(n.updatedAt)}>{formatRelative(n.updatedAt)}</time></td>
              <td className="whitespace-nowrap px-3 py-2 text-stone-700">{n.lastOpenedAt ? formatRelative(n.lastOpenedAt) : "Never"}</td>
              <td className="px-3 py-2 text-right">
                <ActionMenu label={`Actions for ${n.title}`} items={noteActions(n, act)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true" data-testid="library-skeleton">
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i} className="overflow-hidden rounded-xl border border-stone-200 bg-surface">
          <div className="vf-shimmer aspect-[16/10] bg-stone-100" />
          <div className="space-y-2 p-3">
            <div className="vf-shimmer h-4 w-2/3 rounded bg-stone-100" />
            <div className="vf-shimmer h-3 w-1/2 rounded bg-stone-100" />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
/** Notes library (FR-LIB-01..08): /app/notes and /app/folders/:folderId */
export function LibraryPage() {
  const { folderId = null } = useParams();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseLibraryParams(params), [params]);
  const [search, setSearch] = useState(filters.q);
  const navigate = useNavigate();
  const toast = useToast();

  const folders = useFolders();
  const list = useNotesList(filters, { folderId });
  const update = useUpdateNote();
  const duplicate = useDuplicateNote();
  const remove = useDeleteNote();
  const removeFolder = useDeleteFolder();

  const [renaming, setRenaming] = useState(null);
  const [moving, setMoving] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [folderDialog, setFolderDialog] = useState(null); // { folder?, parentId? }
  const [deletingFolder, setDeletingFolder] = useState(null);

  // Functional update: always merge into the CURRENT params (no stale closures,
  // e.g. the debounced search can't undo a filter toggled in the meantime).
  const setFilters = (patch) => setParams((prev) => toLibrarySearchParams({ ...parseLibraryParams(prev), ...patch }), { replace: true });

  // Debounced live search (FR-LIB-03).
  useEffect(() => setSearch(filters.q), [filters.q]);
  useEffect(() => {
    if (search === filters.q) return undefined;
    const t = setTimeout(() => setFilters({ q: search }), 300);
    return () => clearTimeout(t);
  }, [search]);

  const allFolders = folders.data ?? [];
  const activeFolder = folderId && folderId !== "root" ? allFolders.find((f) => f.id === folderId) : null;
  const notes = list.data?.pages.flatMap((p) => p.items) ?? [];
  const total = list.data?.pages[0]?.total ?? 0;
  const heading = folderId === "root" ? "No folder" : activeFolder?.name ?? (folderId ? "Folder" : "All notes");

  function act(action, note) {
    const fail = (err) => toast.error(err.message);
    switch (action) {
      case "open":
        return navigate(`/app/notes/${note.id}`);
      case "rename":
        return setRenaming(note);
      case "move":
        return setMoving(note);
      case "favorite":
        return update.mutate({ id: note.id, patch: { isFavorite: !note.isFavorite } }, { onError: fail });
      case "archive":
        return update.mutate(
          { id: note.id, patch: { isArchived: !note.isArchived } },
          { onSuccess: () => toast.success(note.isArchived ? "Note restored from archive." : "Note archived."), onError: fail }
        );
      case "duplicate":
        return duplicate.mutate({ id: note.id }, { onSuccess: (copy) => toast.success(`Created "${copy.title}".`), onError: fail });
      case "delete":
        return setDeleting(note);
      default:
        return undefined;
    }
  }

  const empty = !list.isPending && !list.isError && notes.length === 0;

  return (
    <div className="lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-8">
      <aside className="mb-6 hidden lg:block">
        <FolderNav folders={allFolders} activeId={folderId} onNewFolder={() => setFolderDialog({ parentId: activeFolder?.id ?? "" })} />
      </aside>

      <div className="min-w-0">
        <PageHeader
          title={heading}
          description={list.isPending ? "Loading…" : `${total} ${total === 1 ? "note" : "notes"}${filters.archived ? " in the archive" : ""}`}
          actions={
            activeFolder ? (
              <>
                <Button size="sm" variant="secondary" onClick={() => setFolderDialog({ folder: activeFolder })}>
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                  Edit folder
                </Button>
                <Button size="sm" variant="dangerOutline" onClick={() => setDeletingFolder(activeFolder)}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Delete folder
                </Button>
              </>
            ) : (
              <ButtonLink to="/app/create" size="sm">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                New visual
              </ButtonLink>
            )
          }
        />

        {/* Folder picker for small screens */}
        <div className="mb-4 flex items-end gap-2 lg:hidden">
          <div className="flex-1">
            <SelectField
              label="Folder"
              value={folderId ?? ""}
              onChange={(e) => navigate(e.target.value ? `/app/folders/${e.target.value}?${params}` : `/app/notes?${params}`)}
            >
              <option value="">All notes</option>
              <option value="root">No folder</option>
              {buildFolderTree(allFolders).map((f) => (
                <option key={f.id} value={f.id}>{`${"  ".repeat(f.depth)}${f.name}`}</option>
              ))}
            </SelectField>
          </div>
          <Button variant="secondary" onClick={() => setFolderDialog({ parentId: activeFolder?.id ?? "" })} aria-label="New folder">
            <FolderPlus className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>

        {/* Toolbar */}
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center" role="search">
          <label className="relative flex-1">
            <span className="sr-only">Search notes by title or tag</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by title or tag"
              maxLength={100}
              className="h-10 w-full rounded-md border border-stone-300 bg-surface pl-9 pr-3 text-sm text-stone-900 placeholder:text-stone-400"
              data-testid="library-search"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant={filters.favorite ? "primary" : "secondary"} aria-pressed={filters.favorite} onClick={() => setFilters({ favorite: !filters.favorite })}>
              <Star className="h-4 w-4" aria-hidden="true" />
              Favorites
            </Button>
            <Button size="sm" variant={filters.archived ? "primary" : "secondary"} aria-pressed={filters.archived} onClick={() => setFilters({ archived: !filters.archived })}>
              <Archive className="h-4 w-4" aria-hidden="true" />
              Archived
            </Button>
            <label className="sr-only" htmlFor="library-sort">Sort</label>
            <select
              id="library-sort"
              value={filters.sort}
              onChange={(e) => setFilters({ sort: e.target.value })}
              className="h-8 rounded-md border border-stone-300 bg-surface px-2 text-sm text-stone-800"
            >
              {SORT_OPTIONS.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
            <SegmentedControl
              label="View"
              size="sm"
              iconOnly
              value={filters.view}
              onChange={(view) => setFilters({ view })}
              options={[
                { value: "grid", label: "Grid view", icon: LayoutGrid },
                { value: "list", label: "List view", icon: List },
              ]}
            />
            {hasActiveFilters(filters) && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSearch("");
                  setFilters({ q: "", tags: [], favorite: false, archived: false });
                }}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                Reset
              </Button>
            )}
          </div>
        </div>

        {filters.tags.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2" aria-label="Active tag filters">
            {filters.tags.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setFilters({ tags: filters.tags.filter((x) => x !== t) })}
                className="inline-flex items-center gap-1 rounded-full bg-accent-50 px-2.5 py-1 text-xs font-medium text-accent-900"
                aria-label={`Remove tag filter ${t}`}
              >
                #{t}
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            ))}
          </div>
        )}

        {list.isPending && <SkeletonGrid />}
        {list.isError && (
          <Card className="p-5" role="alert">
            <p className="text-sm text-red-700">{list.error.message}</p>
            <Button size="sm" variant="secondary" className="mt-3" onClick={() => list.refetch()}>
              Try again
            </Button>
          </Card>
        )}

        {empty &&
          (hasActiveFilters(filters) ? (
            <Card className="p-8 text-center" data-testid="library-empty-filtered">
              <h2 className="text-base font-semibold text-stone-900">No notes match these filters</h2>
              <p className="mt-1 text-sm text-stone-600">
                {filters.archived ? "Nothing is archived here. " : ""}Try a different search, or clear the filters.
              </p>
              <Button variant="secondary" className="mt-4" onClick={() => {
                  setSearch("");
                  setFilters({ q: "", tags: [], favorite: false, archived: false });
                }}>
                Clear filters
              </Button>
            </Card>
          ) : (
            <Card className="p-8 text-center" data-testid="library-empty">
              <Sparkles className="mx-auto h-8 w-8 text-accent-700" aria-hidden="true" />
              <h2 className="mt-3 text-base font-semibold text-stone-900">{folderId ? "This folder is empty" : "Your library is empty"}</h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-stone-600">
                Create a visual from any topic, then choose <strong className="font-medium">Save to library</strong>. Try:{" "}
                <em>&ldquo;Explain how DNS resolves a domain name.&rdquo;</em>
              </p>
              <ButtonLink to={`/app/create?prompt=${encodeURIComponent("Explain how DNS resolves a domain name, step by step.")}`} className="mt-4">
                Create your first visual
              </ButtonLink>
            </Card>
          ))}

        {notes.length > 0 &&
          (filters.view === "list" ? (
            <NoteTable notes={notes} act={act} folders={allFolders} sort={filters.sort} onSort={(sort) => setFilters({ sort })} />
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="note-grid">
              {notes.map((n) => (
                <NoteCard key={n.id} note={n} act={act} onTag={(t) => !filters.tags.includes(t) && setFilters({ tags: [...filters.tags, t].slice(0, 5) })} />
              ))}
            </ul>
          ))}

        {list.hasNextPage && (
          <div className="mt-6 flex justify-center">
            <Button variant="secondary" onClick={() => list.fetchNextPage()} loading={list.isFetchingNextPage} loadingText="Loading…">
              Load more
            </Button>
          </div>
        )}
      </div>

      <RenameNoteDialog note={renaming} onClose={() => setRenaming(null)} />
      <MoveNoteDialog note={moving} onClose={() => setMoving(null)} />
      <FolderDialog
        open={Boolean(folderDialog)}
        folder={folderDialog?.folder ?? null}
        defaultParentId={folderDialog?.parentId ?? ""}
        onClose={() => setFolderDialog(null)}
      />
      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete this note permanently?"
        description={`"${deleting?.title ?? ""}" and all of its versions and exports will be deleted. This can't be undone. Archive it instead if you might need it later.`}
        confirmLabel="Delete note"
        loading={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() =>
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success("Note deleted.");
              setDeleting(null);
            },
            onError: (err) => {
              toast.error(err.message);
              setDeleting(null);
            },
          })
        }
      />
      <ConfirmDialog
        open={Boolean(deletingFolder)}
        title={`Delete the folder "${deletingFolder?.name ?? ""}"?`}
        description="Notes inside move to No folder and subfolders move up one level. No notes are deleted."
        confirmLabel="Delete folder"
        loading={removeFolder.isPending}
        onCancel={() => setDeletingFolder(null)}
        onConfirm={() =>
          removeFolder.mutate(deletingFolder.id, {
            onSuccess: () => {
              toast.success("Folder deleted.");
              setDeletingFolder(null);
              navigate("/app/notes");
            },
            onError: (err) => {
              toast.error(err.message);
              setDeletingFolder(null);
            },
          })
        }
      />
    </div>
  );
}
