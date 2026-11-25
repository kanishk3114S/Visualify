import { env } from "./env.js";
import { supabase } from "./supabase.js";

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
export async function apiRequest(path, { method = "GET", body, formData, signal } = {}) {
  const headers = { "X-Request-Id": newRequestId() };

  const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
  const token = data.session?.access_token;
  if (token) headers.Authorization = `Bearer ${token}`;

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
