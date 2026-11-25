import { describe, it, expect } from "vitest";
import { ActiveJobExistsError, SupabaseJobStore } from "../src/generation/jobStore.js";
import { ACTIVE_STATUSES } from "../src/generation/jobStates.js";

/** Records every supabase-js builder call and resolves with a canned result. */
function recorder(result = { data: { id: "j1" }, error: null }) {
  const calls = [];
  const builder = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return (resolve) => resolve(result);
        if (prop === "maybeSingle" || prop === "single") return () => { calls.push([prop]); return Promise.resolve(result); };
        return (...args) => { calls.push([prop, ...args]); return builder; };
      },
    }
  );
  return { client: { from: (table) => { calls.push(["from", table]); return builder; } }, calls };
}

describe("SupabaseJobStore", () => {
  it("owner reads go through the caller's RLS client AND filter by owner id", async () => {
    const admin = recorder();
    const user = recorder();
    await new SupabaseJobStore(admin.client).getJob({ db: user.client, ownerId: "owner-1", jobId: "job-1" });
    expect(admin.calls).toEqual([]);
    expect(user.calls).toContainEqual(["eq", "id", "job-1"]);
    expect(user.calls).toContainEqual(["eq", "owner_id", "owner-1"]);
  });

  it("runner updates are conditional on the expected status", async () => {
    const admin = recorder();
    await new SupabaseJobStore(admin.client).updateJob("job-1", { status: "planning" }, { expectStatus: ["queued", "validating"] });
    expect(admin.calls).toContainEqual(["update", { status: "planning" }]);
    expect(admin.calls).toContainEqual(["eq", "id", "job-1"]);
    expect(admin.calls).toContainEqual(["in", "status", ["queued", "validating"]]);
  });

  it("inserts with an explicit owner and maps 23505 to ActiveJobExistsError", async () => {
    const admin = recorder({ data: null, error: { code: "23505", message: "duplicate key" } });
    await expect(
      new SupabaseJobStore(admin.client).insertJob({ ownerId: "owner-1", inputText: "x", settings: {} })
    ).rejects.toBeInstanceOf(ActiveJobExistsError);
    const insert = admin.calls.find((c) => c[0] === "insert")[1];
    expect(insert).toMatchObject({ owner_id: "owner-1", input_type: "prompt", input_text: "x", attempt_count: 1 });
    expect(insert).not.toHaveProperty("status");
  });

  it("findActiveJob filters by owner and every active status", async () => {
    const admin = recorder();
    await new SupabaseJobStore(admin.client).findActiveJob("owner-1");
    expect(admin.calls).toContainEqual(["eq", "owner_id", "owner-1"]);
    expect(admin.calls).toContainEqual(["in", "status", ACTIVE_STATUSES]);
  });

  it("wraps database errors without leaking them", async () => {
    const admin = recorder({ data: null, error: { code: "XX000", message: "relation secret_table" } });
    await expect(new SupabaseJobStore(admin.client).findActiveJob("o")).rejects.toMatchObject({ status: 502, code: "DATABASE_ERROR", message: "We couldn't complete that request. Please try again." });
  });

  it("refuses runner writes without a service-role client but still serves owner reads", async () => {
    const store = new SupabaseJobStore(null);
    await expect(store.findActiveJob("o")).rejects.toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    const user = recorder({ data: null, error: null });
    await expect(store.getJob({ db: user.client, ownerId: "o", jobId: "j" })).resolves.toBeNull();
  });
});
