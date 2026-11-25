/**
 * In-memory stand-in for the Supabase gateway used by API tests (offline).
 *
 * It emulates the parts of Supabase the API relies on, INCLUDING ownership
 * enforcement equivalent to the RLS policies in supabase/migrations, so that a
 * bug where the API targets the wrong user would surface as a failing test.
 * The real policies themselves are verified separately on Postgres by
 * supabase/tests/rls.pglite.test.js (offline) and rls.live.test.js (live).
 */
import { randomUUID } from "node:crypto";
import { AppError } from "../../src/utils/errors.js";

export const DEFAULT_PREFERENCES = Object.freeze({
  theme: "light",
  defaultExportFormat: "png",
  learningLevel: "undergraduate",
});

export function createFakeSupabase() {
  const state = {
    tokens: new Map(), // token -> user
    profiles: new Map(), // id -> row
    objects: new Map(), // "bucket/path" -> { buffer, contentType }
    healthy: true,
    authDown: false,
    fail: {}, // { upload, remove, update, select, sign } -> true to inject an error
    calls: [], // { op, user, ...args }
  };

  function issueToken(user) {
    const token = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(user.id).toString("base64url")}.sig${randomUUID().replaceAll("-", "")}`;
    state.tokens.set(token, user);
    return token;
  }

  function addUser({ id = randomUUID(), email = `${id.slice(0, 8)}@example.test`, metadata = {}, withProfile = true, profile = {} } = {}) {
    const user = { id, email, metadata };
    if (withProfile) {
      const now = new Date().toISOString();
      state.profiles.set(id, {
        id,
        display_name: email.split("@")[0],
        username: null,
        avatar_path: null,
        bio: "",
        preferences: { ...DEFAULT_PREFERENCES },
        created_at: now,
        updated_at: now,
        ...profile,
      });
    }
    return { user, token: issueToken(user) };
  }

  const clone = (row) => (row ? structuredClone(row) : row);

  function usernameTaken(username, exceptId) {
    if (username == null) return false;
    for (const row of state.profiles.values()) {
      if (row.id !== exceptId && row.username?.toLowerCase() === username.toLowerCase()) return true;
    }
    return false;
  }

  function profilesTable(user) {
    return {
      select() {
        const filters = [];
        const q = {
          eq(col, val) {
            filters.push([col, val]);
            return q;
          },
          async maybeSingle() {
            state.calls.push({ op: "profiles.select", user: user.id, filters: [...filters] });
            if (state.fail.select) return { data: null, error: { code: "XX000", message: "db down" } };
            // RLS: only the caller's own row is ever visible.
            const rows = [...state.profiles.values()].filter(
              (r) => r.id === user.id && filters.every(([c, v]) => r[c] === v)
            );
            return { data: clone(rows[0] ?? null), error: null };
          },
        };
        return q;
      },
      insert(row) {
        return {
          select() {
            return {
              async single() {
                state.calls.push({ op: "profiles.insert", user: user.id, row });
                if (row.id !== user.id) return { data: null, error: { code: "42501", message: "new row violates row-level security policy" } };
                if (state.profiles.has(row.id)) return { data: null, error: { code: "23505", message: "duplicate key" } };
                const now = new Date().toISOString();
                const full = {
                  id: row.id,
                  display_name: row.display_name ?? "",
                  username: null,
                  avatar_path: null,
                  bio: "",
                  preferences: { ...DEFAULT_PREFERENCES },
                  created_at: now,
                  updated_at: now,
                };
                state.profiles.set(row.id, full);
                return { data: clone(full), error: null };
              },
            };
          },
        };
      },
      update(patch) {
        const filters = [];
        const q = {
          eq(col, val) {
            filters.push([col, val]);
            return q;
          },
          select() {
            return {
              async maybeSingle() {
                state.calls.push({ op: "profiles.update", user: user.id, patch: structuredClone(patch), filters: [...filters] });
                if (state.fail.update) return { data: null, error: { code: "XX000", message: "db down" } };
                const target = [...state.profiles.values()].find(
                  (r) => r.id === user.id && filters.every(([c, v]) => r[c] === v)
                );
                if (!target) return { data: null, error: null }; // RLS: 0 rows
                if ("username" in patch && usernameTaken(patch.username, target.id)) {
                  return { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "profiles_username_lower_key"' } };
                }
                Object.assign(target, structuredClone(patch), { updated_at: new Date().toISOString() });
                return { data: clone(target), error: null };
              },
            };
          },
        };
        return q;
      },
    };
  }

  function bucket(user, name) {
    const ownsPath = (p) => typeof p === "string" && p.split("/")[0] === user.id && p.split("/").length === 2;
    return {
      async upload(path, buffer, opts) {
        state.calls.push({ op: "storage.upload", user: user.id, bucket: name, path, contentType: opts?.contentType, size: buffer.length });
        if (state.fail.upload) return { data: null, error: { message: "storage down", statusCode: "500" } };
        if (!ownsPath(path)) return { data: null, error: { message: "new row violates row-level security policy", statusCode: "403" } };
        const key = `${name}/${path}`;
        if (state.objects.has(key) && !opts?.upsert) return { data: null, error: { message: "The resource already exists", statusCode: "409" } };
        state.objects.set(key, { buffer: Buffer.from(buffer), contentType: opts?.contentType });
        return { data: { path }, error: null };
      },
      async remove(paths) {
        state.calls.push({ op: "storage.remove", user: user.id, bucket: name, paths: [...paths] });
        if (state.fail.remove) return { data: null, error: { message: "storage down", statusCode: "500" } };
        const removed = [];
        for (const p of paths) {
          if (ownsPath(p) && state.objects.delete(`${name}/${p}`)) removed.push({ name: p });
        }
        return { data: removed, error: null };
      },
      async createSignedUrl(path, expiresIn) {
        state.calls.push({ op: "storage.sign", user: user.id, bucket: name, path, expiresIn });
        if (state.fail.sign || !ownsPath(path) || !state.objects.has(`${name}/${path}`)) {
          return { data: null, error: { message: "Object not found", statusCode: "404" } };
        }
        return {
          data: { signedUrl: `https://fake.supabase.test/storage/v1/object/sign/${name}/${path}?token=signed-${expiresIn}` },
          error: null,
        };
      },
    };
  }

  const gateway = {
    async verifyAccessToken(token) {
      state.calls.push({ op: "auth.getUser" });
      if (state.authDown) throw new AppError(503, "AUTH_UNAVAILABLE", "Authentication service is temporarily unavailable.");
      const user = state.tokens.get(token);
      return user ? { ...user } : null;
    },
    createUserClient(token) {
      const user = state.tokens.get(token);
      if (!user) throw new Error("createUserClient called with an unverified token");
      return {
        from: (table) => {
          if (table !== "profiles") throw new Error(`unexpected table ${table}`);
          return profilesTable(user);
        },
        storage: { from: (name) => bucket(user, name) },
      };
    },
    async checkHealth() {
      return state.healthy;
    },
  };

  return { gateway, state, addUser, issueToken };
}
