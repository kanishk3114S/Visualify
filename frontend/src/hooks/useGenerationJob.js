import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { generationsApi } from "../lib/apiClient.js";
import { useAuth } from "../features/auth/AuthContext.jsx";

export const TERMINAL = ["completed", "failed", "cancelled"];
const POLL_MS = 2000;

export const generationKey = (userId, jobId) => ["generation", userId, jobId];

/**
 * Live state of one generation job.
 *
 * Primary channel: SSE over fetch (Bearer header). If the stream errors or
 * closes before a terminal event, falls back to polling GET every 2 s. The
 * full job (plan, scene) is (re)fetched with GET whenever a terminal state is
 * reached, so there is a single source of truth for results.
 */
export function useGenerationJob(jobId) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const key = generationKey(user?.id, jobId);
  const [live, setLive] = useState(null); // { status, stage, progress, safeError }
  const [polling, setPolling] = useState(false);
  const progressRef = useRef(0);

  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => generationsApi.get(jobId, { signal }),
    enabled: Boolean(user?.id && jobId),
    retry: (count, error) => error?.status !== 404 && count < 2,
    refetchInterval: (q) => (polling && !TERMINAL.includes(q.state.data?.status) ? POLL_MS : false),
    refetchOnWindowFocus: false,
  });

  const serverStatus = query.data?.status;
  const done = TERMINAL.includes(serverStatus);

  useEffect(() => {
    progressRef.current = 0;
    setLive(null);
    setPolling(false);
  }, [jobId]);

  useEffect(() => {
    if (!user?.id || !jobId || done || query.isError) return undefined;
    const controller = new AbortController();
    let terminal = false;

    const apply = (patch) => {
      setLive((prev) => {
        const next = { ...(prev ?? {}), ...patch };
        // Progress never moves backwards on screen.
        next.progress = Math.max(progressRef.current, patch.progress ?? prev?.progress ?? 0);
        progressRef.current = next.progress;
        return next;
      });
    };

    generationsApi
      .streamEvents(jobId, {
        signal: controller.signal,
        onEvent: ({ type, data }) => {
          if (type === "snapshot" || type === "stage") apply({ status: data.status, stage: data.stage ?? null, progress: data.progress, safeError: data.safeError ?? null });
          else if (type === "progress") apply({ progress: data.progress });
          else if (TERMINAL.includes(type)) {
            terminal = true;
            apply({ status: data.status, progress: data.progress, safeError: data.error ?? null });
            queryClient.invalidateQueries({ queryKey: key });
          }
        },
      })
      .then(() => {
        if (!terminal && !controller.signal.aborted) setPolling(true);
      })
      .catch((err) => {
        if (controller.signal.aborted || err?.name === "AbortError") return;
        if (err?.status === 404) {
          queryClient.invalidateQueries({ queryKey: key });
          return;
        }
        setPolling(true); // stream dropped: degrade to polling
      });

    return () => controller.abort();
  }, [user?.id, jobId, done, query.isError]);

  // The terminal SSE event can arrive while the *initial* GET is still in
  // flight; TanStack Query then folds the invalidation into that request and
  // returns the stale (non-terminal) job. Re-fetch explicitly until the server
  // view catches up (bounded, so a lagging server can't cause a loop).
  const catchUpAttempts = useRef(0);
  const liveTerminal = TERMINAL.includes(live?.status);
  useEffect(() => {
    if (!liveTerminal || done || query.isFetching || catchUpAttempts.current >= 5) return undefined;
    const timer = setTimeout(() => {
      catchUpAttempts.current += 1;
      query.refetch();
    }, catchUpAttempts.current === 0 ? 0 : 500);
    return () => clearTimeout(timer);
  }, [liveTerminal, done, query.isFetching, query.refetch]);

  useEffect(() => {
    catchUpAttempts.current = 0;
  }, [jobId]);

  // Server data wins once terminal; otherwise the freshest live view.
  const job = query.data ?? null;
  const status = done ? serverStatus : live?.status ?? serverStatus ?? "queued";
  const progress = done
    ? job.progress
    : Math.max(live?.progress ?? 0, job?.progress ?? 0, progressRef.current);
  const stage = done ? null : live?.stage ?? job?.stage ?? null;
  const safeError = done ? job.safeError : live?.safeError ?? job?.safeError ?? null;

  return { job, status, stage, progress, safeError, polling, isLoading: query.isPending, error: query.error, refetch: query.refetch };
}

export function useCreateGeneration() {
  return useMutation({ mutationFn: generationsApi.create });
}

export function useCancelGeneration(jobId) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => generationsApi.cancel(jobId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: generationKey(user?.id, jobId) }),
  });
}

export function useRetryGeneration(jobId) {
  return useMutation({ mutationFn: () => generationsApi.retry(jobId) });
}
