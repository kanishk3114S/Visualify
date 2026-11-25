import { env } from "./env.js";
import { supabase } from "./supabase.js";
import { readSseStream } from "./sse.js";

/** Normalised API failure carrying the server's safe code/message/details. */
export class ApiError extends Error {
  constructor({ status, code, message, details = null, requestId = null }) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

function newRequestId() {
  return `web_${crypto.randomUUID().replaceAll("-", "")}`;
}

/**
 * Calls the Visualify API with the current Supabase access token.
 * supabase.auth.getSession() returns a refreshed token when needed, so the
 * client never manages refresh itself. Accepts JSON `body` or `formData`.
 */
/** Request-id + Bearer headers. supabase-js refreshes the token when needed. */
async function baseHeaders() {
  const headers = { "X-Request-Id": newRequestId() };
  const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
  const token = data.session?.access_token;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function errorFromResponse(response) {
  let envelope = null;
  try {
    envelope = await response.json();
  } catch {
    /* non-JSON */
  }
  return new ApiError({
    status: response.status,
    code: envelope?.error?.code ?? "UNEXPECTED_RESPONSE",
    message: envelope?.error?.message ?? "Something went wrong. Please try again.",
    details: envelope?.error?.details ?? null,
    requestId: envelope?.meta?.requestId ?? response.headers.get("X-Request-Id"),
  });
}

export async function apiRequest(path, { method = "GET", body, formData, signal } = {}) {
  const headers = await baseHeaders();

  let payload;
  if (formData) {
    payload = formData; // browser sets the multipart boundary
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(`${env.apiBaseUrl}/api/v1${path}`, {
      method,
      headers,
      body: payload,
      signal,
      credentials: "omit",
      cache: "no-store",
    });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    throw new ApiError({
      status: 0,
      code: "NETWORK_ERROR",
      message: "We couldn't reach Visualify. Check your connection and try again.",
      requestId: headers["X-Request-Id"],
    });
  }

  let envelope = null;
  try {
    envelope = await response.json();
  } catch {
    /* non-JSON (proxy error page, etc.) */
  }

  if (!response.ok || !envelope?.success) {
    const error = new ApiError({
      status: response.status,
      code: envelope?.error?.code ?? "UNEXPECTED_RESPONSE",
      message: envelope?.error?.message ?? "Something went wrong. Please try again.",
      details: envelope?.error?.details ?? null,
      requestId: envelope?.meta?.requestId ?? response.headers.get("X-Request-Id"),
    });
    // The server rejected a token supabase-js still considered valid (revoked
    // or user deleted): clear the local session so the guard sends the user
    // to sign in instead of leaving them on a broken page.
    if (response.status === 401 && error.code === "INVALID_TOKEN") {
      await supabase?.auth.signOut({ scope: "local" });
    }
    throw error;
  }
  return envelope.data;
}

export const meApi = {
  get: ({ signal } = {}) => apiRequest("/me", { signal }).then((d) => d.profile),
  update: (patch) => apiRequest("/me", { method: "PATCH", body: patch }).then((d) => d.profile),
  uploadAvatar: (file) => {
    const formData = new FormData();
    formData.append("avatar", file);
    return apiRequest("/me/avatar", { method: "POST", formData }).then((d) => d.profile);
  },
  removeAvatar: () => apiRequest("/me/avatar", { method: "DELETE" }).then((d) => d.profile),
};

const jobPath = (jobId) => `/generations/${encodeURIComponent(jobId)}`;

export const generationsApi = {
  create: (body) => apiRequest("/generations", { method: "POST", body }),
  get: (jobId, { signal } = {}) => apiRequest(jobPath(jobId), { signal }).then((d) => d.job),
  cancel: (jobId) => apiRequest(`${jobPath(jobId)}/cancel`, { method: "POST" }),
  retry: (jobId) => apiRequest(`${jobPath(jobId)}/retry`, { method: "POST" }),

  /**
   * Opens the job's SSE stream with fetch + Authorization header (never a
   * token in the URL) and calls onEvent for each event. Resolves when the
   * server closes the stream; rejects on HTTP or network errors.
   */
  async streamEvents(jobId, { signal, onEvent }) {
    const headers = { ...(await baseHeaders()), Accept: "text/event-stream" };
    const response = await fetch(`${env.apiBaseUrl}/api/v1${jobPath(jobId)}/events`, {
      headers,
      signal,
      credentials: "omit",
      cache: "no-store",
    });
    if (!response.ok || !response.body) throw await errorFromResponse(response);
    await readSseStream(response.body, onEvent, { signal });
  },
};

const notePath = (id) => `/notes/${encodeURIComponent(id)}`;

export const notesApi = {
  list: (query, { signal } = {}) => apiRequest(`/notes${query ? `?${query}` : ""}`, { signal }),
  get: (id, { signal } = {}) => apiRequest(notePath(id), { signal }),
  createFromJob: (body) => apiRequest("/notes", { method: "POST", body }),
  update: (id, patch) => apiRequest(notePath(id), { method: "PATCH", body: patch }).then((d) => d.note),
  duplicate: (id, body = {}) => apiRequest(`${notePath(id)}/duplicate`, { method: "POST", body }).then((d) => d.note),
  remove: (id) => apiRequest(notePath(id), { method: "DELETE" }),
  versions: (id, { signal } = {}) => apiRequest(`${notePath(id)}/versions`, { signal }).then((d) => d.items),
  version: (id, versionId, { signal } = {}) =>
    apiRequest(`${notePath(id)}/versions/${encodeURIComponent(versionId)}`, { signal }).then((d) => d.version),
  snapshot: (id, body) => apiRequest(`${notePath(id)}/versions`, { method: "POST", body }),
  restore: (id, versionId) => apiRequest(`${notePath(id)}/restore/${encodeURIComponent(versionId)}`, { method: "POST" }),
  saveDraft: (id, body, { signal } = {}) => apiRequest(`${notePath(id)}/draft`, { method: "PUT", body, signal }),
  exportNote: (id, body) => apiRequest(`${notePath(id)}/exports`, { method: "POST", body }).then((d) => d.export),
  study: (id, { signal } = {}) => apiRequest(`${notePath(id)}/study`, { signal }),
  explain: (id, body) => apiRequest(`${notePath(id)}/explain`, { method: "POST", body }),
  createQuiz: (id, body = {}) => apiRequest(`${notePath(id)}/quiz`, { method: "POST", body }).then((d) => d.quiz),
  submitQuiz: (id, quizId, answers) =>
    apiRequest(`${notePath(id)}/quiz/${encodeURIComponent(quizId)}`, { method: "PATCH", body: { answers } }).then((d) => d.quiz),
  createFlashcards: (id, body = {}) => apiRequest(`${notePath(id)}/flashcards`, { method: "POST", body }).then((d) => d.items),
  updateFlashcard: (id, cardId, mastery) =>
    apiRequest(`${notePath(id)}/flashcards/${encodeURIComponent(cardId)}`, { method: "PATCH", body: { mastery } }).then((d) => d.flashcard),
  createRevision: (id) => apiRequest(`${notePath(id)}/revision`, { method: "POST" }).then((d) => d.revisionGuide),
  ask: (id, question) => apiRequest(`${notePath(id)}/ask`, { method: "POST", body: { question } }),
  regenerateSection: (id, sectionId, body) =>
    apiRequest(`${notePath(id)}/sections/${encodeURIComponent(sectionId)}/regenerate`, { method: "POST", body }),
};

export const sourcesApi = {
  upload: (file, { signal } = {}) => {
    const formData = new FormData();
    formData.append("file", file);
    return apiRequest("/sources/upload", { method: "POST", formData, signal }).then((d) => d.sourceFile);
  },
  get: (id, { signal } = {}) => apiRequest(`/sources/${encodeURIComponent(id)}`, { signal }).then((d) => d.sourceFile),
  remove: (id) => apiRequest(`/sources/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

export const foldersApi = {
  list: ({ signal } = {}) => apiRequest("/folders", { signal }).then((d) => d.items),
  create: (body) => apiRequest("/folders", { method: "POST", body }).then((d) => d.folder),
  update: (id, patch) => apiRequest(`/folders/${encodeURIComponent(id)}`, { method: "PATCH", body: patch }).then((d) => d.folder),
  remove: (id) => apiRequest(`/folders/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
