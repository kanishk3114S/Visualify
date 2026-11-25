import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { foldersApi, notesApi } from "../lib/apiClient.js";
import { useAuth } from "../features/auth/AuthContext.jsx";
import { toNotesQuery } from "../lib/libraryFilters.js";

export const PAGE_SIZE = 24;
// Signed preview URLs live 10 minutes; refresh lists before they expire.
const LIST_STALE_MS = 60_000;

export const notesKeys = {
  all: (userId) => ["notes", userId],
  list: (userId, query) => ["notes", userId, "list", query],
  detail: (userId, id) => ["notes", userId, "detail", id],
  versions: (userId, id) => ["notes", userId, "versions", id],
  study: (userId, id) => ["notes", userId, "study", id],
  folders: (userId) => ["folders", userId],
};

function useKeys() {
  const { user } = useAuth();
  return { userId: user?.id, enabled: Boolean(user?.id) };
}

/** Infinite library list ("Load more"). */
export function useNotesList(filters, { folderId = null } = {}) {
  const { userId, enabled } = useKeys();
  const base = toNotesQuery(filters, { folderId, limit: PAGE_SIZE });
  return useInfiniteQuery({
    queryKey: notesKeys.list(userId, base),
    queryFn: ({ pageParam, signal }) => notesApi.list(toNotesQuery(filters, { folderId, limit: PAGE_SIZE, offset: pageParam }), { signal }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.offset + last.items.length < last.total ? last.offset + last.items.length : undefined),
    enabled,
    staleTime: LIST_STALE_MS,
    refetchInterval: 5 * 60_000,
  });
}

/** Small fixed lists (dashboard widgets). */
export function useNotesQuery(query) {
  const { userId, enabled } = useKeys();
  return useQuery({
    queryKey: notesKeys.list(userId, query),
    queryFn: ({ signal }) => notesApi.list(query, { signal }),
    enabled,
    staleTime: LIST_STALE_MS,
  });
}

export function useNote(id) {
  const { userId, enabled } = useKeys();
  return useQuery({
    queryKey: notesKeys.detail(userId, id),
    queryFn: ({ signal }) => notesApi.get(id, { signal }),
    enabled: enabled && Boolean(id),
    retry: (count, error) => error?.status !== 404 && count < 2,
    refetchOnWindowFocus: false, // the editor owns the live scene
    staleTime: 30_000,
  });
}

export function useVersions(id, { enabled = true } = {}) {
  const { userId, enabled: auth } = useKeys();
  return useQuery({
    queryKey: notesKeys.versions(userId, id),
    queryFn: ({ signal }) => notesApi.versions(id, { signal }),
    enabled: auth && enabled && Boolean(id),
  });
}

export function useFolders() {
  const { userId, enabled } = useKeys();
  return useQuery({ queryKey: notesKeys.folders(userId), queryFn: ({ signal }) => foldersApi.list({ signal }), enabled, staleTime: 60_000 });
}

/** Mutation that refreshes every notes/folders query for this user afterwards. */
function useNotesMutation(mutationFn) {
  const { userId } = useKeys();
  const qc = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: notesKeys.all(userId) });
      qc.invalidateQueries({ queryKey: notesKeys.folders(userId) });
    },
  });
}

export const useUpdateNote = () => useNotesMutation(({ id, patch }) => notesApi.update(id, patch));
export const useDuplicateNote = () => useNotesMutation(({ id, title }) => notesApi.duplicate(id, title ? { title } : {}));
export const useDeleteNote = () => useNotesMutation((id) => notesApi.remove(id));
export const useSaveGeneration = () => useNotesMutation((body) => notesApi.createFromJob(body));
export const useCreateFolder = () => useNotesMutation((body) => foldersApi.create(body));
export const useUpdateFolder = () => useNotesMutation(({ id, patch }) => foldersApi.update(id, patch));
export const useDeleteFolder = () => useNotesMutation((id) => foldersApi.remove(id));
export const useSnapshot = () => useNotesMutation(({ id, sceneJson, description }) => notesApi.snapshot(id, { sceneJson, description }));
export const useRestoreVersion = () => useNotesMutation(({ id, versionId }) => notesApi.restore(id, versionId));
export const useExportNote = () => useMutation({ mutationFn: ({ id, ...body }) => notesApi.exportNote(id, body) });

// Phase 5 study companion hooks
export function useNoteStudy(id, { enabled = true } = {}) {
  const { userId, enabled: auth } = useKeys();
  return useQuery({
    queryKey: notesKeys.study(userId, id),
    queryFn: ({ signal }) => notesApi.study(id, { signal }),
    enabled: auth && enabled && Boolean(id),
    staleTime: 30_000,
  });
}

export const useExplainSelection = () => useMutation({ mutationFn: ({ id, ...body }) => notesApi.explain(id, body) });

export const useCreateQuiz = () => useNotesMutation(({ id, ...body }) => notesApi.createQuiz(id, body));

export const useSubmitQuiz = () => useNotesMutation(({ id, quizId, answers }) => notesApi.submitQuiz(id, quizId, answers));

export const useCreateFlashcards = () => useNotesMutation(({ id, ...body }) => notesApi.createFlashcards(id, body));

export const useUpdateFlashcard = () => useNotesMutation(({ id, cardId, mastery }) => notesApi.updateFlashcard(id, cardId, mastery));

export const useCreateRevision = () => useNotesMutation((id) => notesApi.createRevision(id));

export const useAskNote = () => useMutation({ mutationFn: ({ id, question }) => notesApi.ask(id, question) });

export const useRegenerateSection = () => useNotesMutation(({ id, sectionId, ...body }) => notesApi.regenerateSection(id, sectionId, body));
