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
    sourceFiles: new Map(), // id -> row
    objects: new Map(), // "bucket/path" -> { buffer, contentType }
    usageEvents: [],
    productEvents: [],
    passwords: new Map(), // email -> password
    deletedUsers: new Set(),
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

  function addUser({
    id = randomUUID(),
    email = `${id.slice(0, 8)}@example.test`,
    password = "Password123!",
    metadata = {},
    appMetadata = {},
    lastSignInAt = new Date().toISOString(),
    withProfile = true,
    profile = {},
  } = {}) {
    const user = { id, email, metadata, appMetadata, lastSignInAt };
    state.passwords.set(email.toLowerCase(), password);
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

  function sourceFilesTable(user) {
    return {
      select() {
        const filters = [];
        const q = {
          eq(col, val) {
            filters.push([col, val]);
            return q;
          },
          async maybeSingle() {
            state.calls.push({ op: "source_files.select", user: user.id, filters: [...filters] });
            if (state.fail.select) return { data: null, error: { code: "XX000", message: "db down" } };
            const rows = [...state.sourceFiles.values()].filter(
              (r) => r.owner_id === user.id && filters.every(([c, v]) => r[c] === v)
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
                state.calls.push({ op: "source_files.insert", user: user.id, row });
                if (state.fail.insert) return { data: null, error: { code: "XX000", message: "db insert fail" } };
                if (row.owner_id !== user.id) return { data: null, error: { code: "42501", message: "rls" } };
                const now = new Date().toISOString();
                const full = {
                  id: row.id ?? randomUUID(),
                  owner_id: row.owner_id,
                  note_id: null,
                  bucket: row.bucket ?? "source-files",
                  object_path: row.object_path,
                  original_name: row.original_name,
                  mime_type: row.mime_type,
                  size_bytes: row.size_bytes,
                  checksum: row.checksum,
                  page_count: row.page_count ?? null,
                  width: row.width ?? null,
                  height: row.height ?? null,
                  extraction_status: "uploaded",
                  extracted_metadata: {},
                  error_code: null,
                  safe_error_message: null,
                  created_at: now,
                  updated_at: now,
                };
                state.sourceFiles.set(full.id, full);
                return { data: clone(full), error: null };
              },
            };
          },
        };
      },
      delete() {
        const filters = [];
        const q = {
          eq(col, val) {
            filters.push([col, val]);
            return q;
          },
          then(resolve) {
            state.calls.push({ op: "source_files.delete", user: user.id, filters: [...filters] });
            if (state.fail.delete) return Promise.resolve({ data: null, error: { code: "XX000", message: "db del fail" } }).then(resolve);
            for (const [id, r] of state.sourceFiles) {
              if (r.owner_id === user.id && filters.every(([c, v]) => r[c] === v)) {
                state.sourceFiles.delete(id);
              }
            }
            return Promise.resolve({ data: null, error: null }).then(resolve);
          },
        };
        return q;
      },
    };
  }

  function bucket(user, name) {
    const ownsPath = (p) => typeof p === "string" && p.split("/")[0] === user.id && p.split("/").length >= 2;
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
      async list(prefix = "") {
        const clean = String(prefix).replace(/\/+$/, "");
        if (!clean || clean.split("/")[0] !== user.id) return { data: [], error: null };
        const entries = new Map();
        const prefixDot = `${name}/${clean}/`;
        for (const k of state.objects.keys()) {
          if (!k.startsWith(prefixDot)) continue;
          const rest = k.slice(prefixDot.length);
          const slash = rest.indexOf("/");
          const seg = slash === -1 ? rest : rest.slice(0, slash);
          if (!entries.has(seg)) entries.set(seg, { name: seg, id: slash === -1 ? "obj" : null });
        }
        return { data: [...entries.values()], error: null };
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
      if (!user || state.deletedUsers.has(user.id)) return null;
      return { ...user };
    },
    async verifyPassword(email, password) {
      state.calls.push({ op: "auth.signInWithPassword" });
      return Boolean(email && password && state.passwords.get(String(email).toLowerCase()) === password);
    },
    async deleteAuthUser(userId) {
      state.calls.push({ op: "auth.admin.deleteUser", userId });
      state.deletedUsers.add(userId);
      state.profiles.delete(userId);
      for (const [id, sf] of state.sourceFiles.entries()) {
        if (sf.owner_id === userId) state.sourceFiles.delete(id);
      }
      for (const [tok, u] of state.tokens.entries()) {
        if (u.id === userId) state.tokens.delete(tok);
      }
    },
    createUserClient(token) {
      const user = state.tokens.get(token);
      if (!user) throw new Error("createUserClient called with an unverified token");
      return {
        from: (table) => {
          if (table === "profiles") return profilesTable(user);
          if (table === "source_files") return sourceFilesTable(user);
          if (table === "usage_events") {
            const filters = { eq: [], gte: [], lt: [] };
            const q = {
              select() { return q; },
              eq(c, v) { filters.eq.push([c, v]); return q; },
              gte(c, v) { filters.gte.push([c, v]); return q; },
              lt(c, v) { filters.lt.push([c, v]); return q; },
              then(resolve) {
                const rows = state.usageEvents.filter(
                  (r) =>
                    r.owner_id === user.id &&
                    filters.eq.every(([c, v]) => r[c] === v) &&
                    filters.gte.every(([c, v]) => r[c] >= v) &&
                    filters.lt.every(([c, v]) => r[c] < v)
                );
                return Promise.resolve({ data: clone(rows), error: null }).then(resolve);
              },
            };
            return q;
          }
          throw new Error(`unexpected table ${table}`);
        },
        storage: { from: (name) => bucket(user, name) },
      };
    },
    createAdminClient() {
      return {
        storage: {
          from: (name) => ({
            list(prefix = "") {
              const clean = String(prefix).replace(/\/+$/, "");
              const entries = new Map();
              const prefixDot = `${name}/${clean}/`;
              for (const k of state.objects.keys()) {
                if (!k.startsWith(prefixDot)) continue;
                const rest = k.slice(prefixDot.length);
                const slash = rest.indexOf("/");
                const seg = slash === -1 ? rest : rest.slice(0, slash);
                if (!entries.has(seg)) entries.set(seg, { name: seg, id: slash === -1 ? "obj" : null });
              }
              return Promise.resolve({ data: [...entries.values()], error: null });
            },
            remove(paths) {
              const removed = [];
              for (const p of paths) {
                if (state.objects.delete(`${name}/${p}`)) removed.push({ name: p });
              }
              return Promise.resolve({ data: removed, error: null });
            },
          }),
        },
      };
    },
    async checkHealth() {
      return state.healthy;
    },
  };

  return { gateway, state, addUser, issueToken };
}
