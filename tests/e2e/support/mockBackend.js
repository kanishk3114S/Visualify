/**
 * E2E helpers: a signed-in browser session without a real Supabase project,
 * plus a contract-faithful mock of the Visualify API (standard envelope,
 * same codes) served through page.route().
 */
export const API_BASE = "http://127.0.0.1:5999"; // must match playwright.config.js
export const APP_ORIGIN = "http://127.0.0.1:5174"; // must match playwright.config.js
export const AUTH_STORAGE_KEY = "visualify-auth";

export const TEST_USER = Object.freeze({
  id: "7d2b1f0e-4c1a-4b7e-9a51-2f9e6c3d8a10",
  email: "e2e.student@example.test",
});

export function makeProfile(overrides = {}) {
  return {
    id: TEST_USER.id,
    email: TEST_USER.email,
    display_name: "Ada Student",
    username: null,
    bio: "",
    preferences: { theme: "light", defaultExportFormat: "png", learningLevel: "undergraduate" },
    avatar_url: null,
    avatar_url_expires_at: null,
    created_at: "2026-11-25T00:00:00.000Z",
    updated_at: "2026-11-25T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * Seeds localStorage with a supabase-js session before any app script runs.
 * Seeds only once per tab, so a real sign-out is not undone by the next navigation.
 */
export async function signInWithFakeSession(page) {
  await page.addInitScript(
    ({ key, user }) => {
      if (window.sessionStorage.getItem("e2e-seeded")) return;
      window.sessionStorage.setItem("e2e-seeded", "1");
      const now = Math.floor(Date.now() / 1000);
      window.localStorage.setItem(
        key,
        JSON.stringify({
          access_token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJlMmUifQ.e2e-signature",
          refresh_token: "e2e-refresh-token",
          token_type: "bearer",
          expires_in: 3600,
          expires_at: now + 3600,
          user: {
            id: user.id,
            aud: "authenticated",
            role: "authenticated",
            email: user.email,
            app_metadata: { provider: "email", providers: ["email"] },
            user_metadata: { display_name: "Ada Student" },
            created_at: "2026-11-25T00:00:00.000Z",
          },
        })
      );
    },
    { key: AUTH_STORAGE_KEY, user: TEST_USER }
  );
}

const ok = (data) => ({ success: true, data, error: null, meta: { requestId: "req_e2e" } });
const fail = (code, message, details = null) => ({ success: false, data: null, error: { code, message, details }, meta: { requestId: "req_e2e" } });

/**
 * Intercepts /api/v1/* with an in-memory profile. Returns the call log and
 * a handle to the current profile so tests can assert on what was sent.
 */
export async function mockApi(page, { profile = makeProfile(), takenUsernames = [], failMe = false, generations = null } = {}) {
  const state = { profile: structuredClone(profile), calls: [], generations };

  await page.route(`${API_BASE}/api/v1/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const cors = {
      "access-control-allow-origin": APP_ORIGIN,
      "access-control-allow-methods": "GET,POST,PATCH,DELETE",
      "access-control-allow-headers": "Authorization,Content-Type,X-Request-Id",
      "access-control-expose-headers": "X-Request-Id",
    };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });

    const json = (status, body) =>
      route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });

    const auth = req.headers()["authorization"] ?? "";
    state.calls.push({ method: req.method(), path: url.pathname, auth, requestId: req.headers()["x-request-id"] });
    if (!auth.startsWith("Bearer ")) return json(401, fail("UNAUTHORIZED", "Authentication required."));

    if (url.pathname === "/api/v1/me" && req.method() === "GET") {
      if (failMe) return json(502, fail("DATABASE_ERROR", "We couldn't complete that request. Please try again."));
      return json(200, ok({ profile: state.profile }));
    }
    if (url.pathname === "/api/v1/me" && req.method() === "PATCH") {
      const patch = req.postDataJSON();
      state.calls.at(-1).body = structuredClone(patch);
      if (patch.username && takenUsernames.includes(patch.username.toLowerCase())) {
        return json(409, fail("USERNAME_TAKEN", "That username is already taken.", [{ field: "username", message: "That username is already taken." }]));
      }
      if (patch.preferences) patch.preferences = { ...state.profile.preferences, ...patch.preferences };
      if (patch.username === "") patch.username = null;
      state.profile = { ...state.profile, ...patch, updated_at: new Date().toISOString() };
      return json(200, ok({ profile: state.profile }));
    }
    if (url.pathname === "/api/v1/me/avatar" && req.method() === "POST") {
      state.calls.at(-1).contentType = req.headers()["content-type"];
      state.profile = {
        ...state.profile,
        avatar_url:
          "data:image/svg+xml;utf8," +
          encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#0f766e"/></svg>'),
        avatar_url_expires_at: new Date(Date.now() + 300_000).toISOString(),
      };
      return json(201, ok({ profile: state.profile }));
    }
    if (url.pathname === "/api/v1/me/avatar" && req.method() === "DELETE") {
      state.profile = { ...state.profile, avatar_url: null, avatar_url_expires_at: null };
      return json(200, ok({ profile: state.profile }));
    }
    if (url.pathname.startsWith("/api/v1/generations") && state.generations) {
      return state.generations.handle({ route, req, url, json, cors, ok, fail, calls: state.calls });
    }
    return json(404, fail("NOT_FOUND", "The requested resource was not found."));
  });
  return state;
}

/** Collects console errors and uncaught page errors for zero-error assertions. */
export function trackErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  return errors;
}

/** Records whether an element matching `selector` was EVER attached to the DOM. */
export async function watchForSelector(page, selector) {
  await page.addInitScript((sel) => {
    window.__sawProtected = false;
    const check = () => {
      if (document.querySelector(sel)) window.__sawProtected = true;
    };
    new MutationObserver(check).observe(document, { childList: true, subtree: true });
    document.addEventListener("DOMContentLoaded", check);
  }, selector);
}
