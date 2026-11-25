import { describe, it, expect } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { buildTestApp } from "./helpers/testApp.js";
import { gifFixture, jpegWithExifFixture, pngFixture, webpFixture } from "./helpers/images.js";

const AVATAR_PATH_RE = (uid) => new RegExp(`^${uid}/avatar-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.webp$`);

function setup(envOverrides) {
  const ctx = buildTestApp(envOverrides);
  const alice = ctx.addUser({ email: "alice@example.test" });
  const bob = ctx.addUser({ email: "bob@example.test" });
  const as = (who) => ({
    get: (url) => request(ctx.app).get(url).set("Authorization", `Bearer ${who.token}`),
    patch: (url) => request(ctx.app).patch(url).set("Authorization", `Bearer ${who.token}`),
    post: (url) => request(ctx.app).post(url).set("Authorization", `Bearer ${who.token}`),
    delete: (url) => request(ctx.app).delete(url).set("Authorization", `Bearer ${who.token}`),
  });
  return { ...ctx, alice, bob, as };
}

// ---------------------------------------------------------------------------
describe("GET /api/v1/me", () => {
  it("returns the caller's profile in the standard envelope", async () => {
    const { as, alice } = setup();
    const res = await as(alice).get("/api/v1/me");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      error: null,
      meta: { requestId: expect.any(String) },
      data: {
        profile: {
          id: alice.user.id,
          email: "alice@example.test",
          display_name: "alice",
          username: null,
          bio: "",
          avatar_url: null,
          avatar_url_expires_at: null,
          preferences: { theme: "light", defaultExportFormat: "png", learningLevel: "undergraduate" },
        },
      },
    });
    expect(res.body.data.profile).not.toHaveProperty("avatar_path");
  });

  it("hydrates a missing profile row (trigger never ran) from the verified identity", async () => {
    const ctx = buildTestApp();
    const carol = ctx.addUser({ email: "carol@example.test", withProfile: false, metadata: { full_name: "Carol Example" } });
    const res = await request(ctx.app).get("/api/v1/me").set("Authorization", `Bearer ${carol.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.profile).toMatchObject({ id: carol.user.id, display_name: "Carol Example" });
    expect(ctx.state.profiles.has(carol.user.id)).toBe(true);
  });

  it("returns a short-lived signed avatar URL when an avatar exists", async () => {
    const { as, alice } = setup();
    const up = await as(alice).post("/api/v1/me/avatar").attach("avatar", await pngFixture(), "me.png");
    expect(up.status).toBe(201);
    const res = await as(alice).get("/api/v1/me");
    expect(res.body.data.profile.avatar_url).toMatch(/^https:\/\/fake\.supabase\.test\/storage\/v1\/object\/sign\/avatars\//);
    expect(res.body.data.profile.avatar_url).toContain("signed-300");
    const expires = new Date(res.body.data.profile.avatar_url_expires_at).getTime();
    expect(expires - Date.now()).toBeGreaterThan(250_000);
    expect(expires - Date.now()).toBeLessThanOrEqual(300_000);
  });

  it("degrades to avatar_url=null (not 500) when the stored object is missing", async () => {
    const { as, alice, state } = setup();
    await as(alice).post("/api/v1/me/avatar").attach("avatar", await pngFixture(), "me.png");
    state.objects.clear();
    const res = await as(alice).get("/api/v1/me");
    expect(res.status).toBe(200);
    expect(res.body.data.profile.avatar_url).toBeNull();
  });

  it("refuses to sign an avatar_path outside the caller's folder", async () => {
    const { as, alice, bob, state } = setup();
    // Simulates a tampered row pointing at someone else's object.
    state.profiles.get(alice.user.id).avatar_path = `${bob.user.id}/avatar-00000000-0000-4000-8000-000000000000.webp`;
    const res = await as(alice).get("/api/v1/me");
    expect(res.body.data.profile.avatar_url).toBeNull();
    expect(state.calls.some((c) => c.op === "storage.sign")).toBe(false);
  });

  it("returns a safe 502 envelope (no DB internals) when the database errors", async () => {
    const { as, alice, state } = setup();
    state.fail.select = true;
    const res = await as(alice).get("/api/v1/me");
    expect(res.status).toBe(502);
    expect(res.body.error).toEqual({
      code: "DATABASE_ERROR",
      message: "We couldn't complete that request. Please try again.",
      details: null,
    });
    expect(JSON.stringify(res.body)).not.toContain("db down");
  });
});

// ---------------------------------------------------------------------------
describe("PATCH /api/v1/me", () => {
  it("updates allowlisted fields and returns the new profile", async () => {
    const { as, alice } = setup();
    const res = await as(alice)
      .patch("/api/v1/me")
      .send({ display_name: "  Alice A.  ", username: "Alice_01", bio: "Learning OS concepts\nwith diagrams." });
    expect(res.status).toBe(200);
    expect(res.body.data.profile).toMatchObject({
      display_name: "Alice A.",
      username: "Alice_01",
      bio: "Learning OS concepts\nwith diagrams.",
    });
  });

  it("treats an empty username as clearing it", async () => {
    const { as, alice } = setup();
    await as(alice).patch("/api/v1/me").send({ username: "alice_x" });
    const res = await as(alice).patch("/api/v1/me").send({ username: "" });
    expect(res.status).toBe(200);
    expect(res.body.data.profile.username).toBeNull();
  });

  it("merges a partial preferences patch", async () => {
    const { as, alice } = setup();
    const res = await as(alice).patch("/api/v1/me").send({ preferences: { learningLevel: "postgraduate" } });
    expect(res.status).toBe(200);
    expect(res.body.data.profile.preferences).toEqual({
      theme: "light",
      defaultExportFormat: "png",
      learningLevel: "postgraduate",
    });
  });

  it.each([
    ["username with invalid characters", { username: "bad name!" }, "username"],
    ["username too short", { username: "ab" }, "username"],
    ["username too long", { username: "a".repeat(31) }, "username"],
    ["oversized bio", { bio: "b".repeat(301) }, "bio"],
    ["oversized display_name", { display_name: "d".repeat(81) }, "display_name"],
    ["control characters in display_name", { display_name: "evil\u0000name" }, "display_name"],
    ["wrong type", { display_name: 42 }, "display_name"],
    ["unknown preference value", { preferences: { theme: "neon" } }, "preferences.theme"],
    ["unknown preference key", { preferences: { admin: true } }, "preferences"],
  ])("rejects %s with 400 VALIDATION_ERROR", async (_label, body, field) => {
    const { as, alice, state } = setup();
    const res = await as(alice).patch("/api/v1/me").send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details.map((d) => d.field)).toContain(field);
    expect(state.calls.some((c) => c.op === "profiles.update")).toBe(false);
  });

  it.each([
    [{ bio: "x", is_admin: true }],
    [{ bio: "x", avatar_path: "someone/else.webp" }],
    [{ bio: "x", created_at: "2000-01-01" }],
  ])("rejects unknown / non-allowlisted fields %j", async (body) => {
    const { as, alice, state } = setup();
    const res = await as(alice).patch("/api/v1/me").send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(state.calls.some((c) => c.op === "profiles.update")).toBe(false);
  });

  it("rejects an empty patch", async () => {
    const { as, alice } = setup();
    const res = await as(alice).patch("/api/v1/me").send({});
    expect(res.status).toBe(400);
  });

  it("rejects malformed JSON with 400 INVALID_JSON", async () => {
    const { as, alice } = setup();
    const res = await as(alice).patch("/api/v1/me").set("Content-Type", "application/json").send('{"bio": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_JSON");
  });

  it("maps a case-insensitive username collision to 409 USERNAME_TAKEN", async () => {
    const { as, alice, bob } = setup();
    expect((await as(alice).patch("/api/v1/me").send({ username: "SharedName" })).status).toBe(200);
    const res = await as(bob).patch("/api/v1/me").send({ username: "sharedname" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: "USERNAME_TAKEN",
      message: "That username is already taken.",
      details: [{ field: "username", message: "That username is already taken." }],
    });
    expect(JSON.stringify(res.body)).not.toMatch(/duplicate key|constraint|23505/);
  });

  it("ownership: identity comes only from the JWT - body id/owner_id are rejected, never used", async () => {
    const { as, alice, bob, state } = setup();
    const res = await as(bob).patch("/api/v1/me").send({ bio: "pwned", id: alice.user.id, owner_id: alice.user.id });
    expect(res.status).toBe(400);
    expect(state.profiles.get(alice.user.id).bio).toBe("");

    const ok = await as(bob).patch("/api/v1/me").send({ bio: "bob's own bio" });
    expect(ok.status).toBe(200);
    expect(ok.body.data.profile.id).toBe(bob.user.id);
    const updates = state.calls.filter((c) => c.op === "profiles.update");
    expect(updates).toHaveLength(1);
    expect(updates[0].user).toBe(bob.user.id);
    expect(updates[0].filters).toEqual([["id", bob.user.id]]);
    expect(state.profiles.get(alice.user.id).bio).toBe("");
  });

  it("rate-limits profile mutations per user with a 429 envelope", async () => {
    const { as, alice, bob } = setup();
    let last;
    for (let i = 0; i < 31; i += 1) last = await as(alice).patch("/api/v1/me").send({ bio: `n${i}` });
    expect(last.status).toBe(429);
    expect(last.body).toMatchObject({ success: false, error: { code: "RATE_LIMITED" } });
    // Per-user key: another user is unaffected.
    expect((await as(bob).patch("/api/v1/me").send({ bio: "fine" })).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
describe("POST /api/v1/me/avatar", () => {
  it.each([
    ["PNG", pngFixture, "photo.png"],
    ["WebP", webpFixture, "photo.webp"],
    ["JPEG with EXIF", jpegWithExifFixture, "photo.jpg"],
  ])("converts a valid %s into a sanitized 256x256 WebP at a UUID path", async (_label, make, filename) => {
    const { as, alice, state } = setup();
    const res = await as(alice).post("/api/v1/me/avatar").attach("avatar", await make(), filename);
    expect(res.status).toBe(201);
    expect(res.body.data.profile.avatar_url).toContain("/sign/avatars/");

    const stored = state.profiles.get(alice.user.id).avatar_path;
    expect(stored).toMatch(AVATAR_PATH_RE(alice.user.id));
    expect(stored).not.toContain(filename.split(".")[0]);

    const upload = state.calls.find((c) => c.op === "storage.upload");
    expect(upload).toMatchObject({ bucket: "avatars", contentType: "image/webp", user: alice.user.id });

    const obj = state.objects.get(`avatars/${stored}`);
    const meta = await sharp(obj.buffer).metadata();
    expect(meta.format).toBe("webp");
    expect([meta.width, meta.height]).toEqual([256, 256]);
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(obj.buffer.includes(Buffer.from("SECRET-EXIF-MARKER"))).toBe(false);
  });

  it("deletes the previous avatar object when replaced", async () => {
    const { as, alice, state } = setup();
    await as(alice).post("/api/v1/me/avatar").attach("avatar", await pngFixture(), "a.png");
    const first = state.profiles.get(alice.user.id).avatar_path;
    await as(alice).post("/api/v1/me/avatar").attach("avatar", await webpFixture(), "b.webp");
    const second = state.profiles.get(alice.user.id).avatar_path;
    expect(second).not.toBe(first);
    expect(state.objects.has(`avatars/${first}`)).toBe(false);
    expect(state.objects.has(`avatars/${second}`)).toBe(true);
    expect([...state.objects.keys()]).toHaveLength(1);
  });

  it.each([
    ["plain text renamed to .png", Buffer.from("hello, definitely not an image"), "fake.png", "image/png"],
    ["HTML/script renamed to .jpg", Buffer.from("<html><script>alert(1)</script></html>"), "x.jpg", "image/jpeg"],
    ["SVG (scriptable) image", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), "x.svg", "image/svg+xml"],
    ["PDF renamed to .webp", Buffer.from("%PDF-1.7\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n"), "x.webp", "image/webp"],
    ["random binary", Buffer.from([0x00, 0x01, 0x02, 0x03, 0xfe, 0xff, 0x10, 0x20, 0x30, 0x40, 0x50, 0x60]), "x.png", "image/png"],
  ])("rejects %s by magic bytes with 415", async (_label, buffer, filename, contentType) => {
    const { as, alice, state } = setup();
    const res = await as(alice).post("/api/v1/me/avatar").attach("avatar", buffer, { filename, contentType });
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe("UNSUPPORTED_FILE_TYPE");
    expect(state.calls.some((c) => c.op === "storage.upload")).toBe(false);
  });

  it("rejects a real but non-allowlisted image type (GIF) with 415", async () => {
    const { as, alice } = setup();
    const res = await as(alice).post("/api/v1/me/avatar").attach("avatar", await gifFixture(), "x.png");
    expect(res.status).toBe(415);
  });

  it("rejects a truncated/corrupt PNG with 422 INVALID_IMAGE", async () => {
    const { as, alice } = setup();
    const png = await pngFixture();
    const res = await as(alice).post("/api/v1/me/avatar").attach("avatar", png.subarray(0, 60), "x.png");
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("INVALID_IMAGE");
  });

  it("rejects oversized files with 413 FILE_TOO_LARGE", async () => {
    const { as, alice, state } = setup({ AVATAR_MAX_BYTES: "4096" });
    const big = await pngFixture(800, 800); // well over 4 KiB
    expect(big.length).toBeGreaterThan(4096);
    const res = await as(alice).post("/api/v1/me/avatar").attach("avatar", big, "big.png");
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("FILE_TOO_LARGE");
    expect(state.calls.some((c) => c.op === "storage.upload")).toBe(false);
  });

  it("rejects images over the pixel-dimension limit (decompression-bomb guard) with 422", async () => {
    const { as, alice } = setup();
    const huge = await pngFixture(5000, 10);
    const res = await as(alice).post("/api/v1/me/avatar").attach("avatar", huge, "wide.png");
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("IMAGE_DIMENSIONS_TOO_LARGE");
  });

  it("requires a file in the 'avatar' field", async () => {
    const { as, alice } = setup();
    const none = await as(alice).post("/api/v1/me/avatar");
    expect(none.status).toBe(400);
    expect(none.body.error.code).toBe("FILE_REQUIRED");
    const wrongField = await as(alice).post("/api/v1/me/avatar").attach("photo", await pngFixture(), "a.png");
    expect(wrongField.status).toBe(400);
    expect(wrongField.body.error.code).toBe("UNEXPECTED_FILE_FIELD");
  });

  it("rejects multiple files", async () => {
    const { as, alice } = setup();
    const png = await pngFixture();
    const res = await as(alice).post("/api/v1/me/avatar").attach("avatar", png, "a.png").attach("avatar", png, "b.png");
    expect(res.status).toBe(400);
  });

  it("rolls back the uploaded object if the profile update fails", async () => {
    const { as, alice, state } = setup();
    state.fail.update = true;
    const res = await as(alice).post("/api/v1/me/avatar").attach("avatar", await pngFixture(), "a.png");
    expect(res.status).toBe(502);
    expect(state.objects.size).toBe(0);
    expect(state.profiles.get(alice.user.id).avatar_path).toBeNull();
  });

  it("returns 502 STORAGE_ERROR when storage rejects the upload", async () => {
    const { as, alice, state } = setup();
    state.fail.upload = true;
    const res = await as(alice).post("/api/v1/me/avatar").attach("avatar", await pngFixture(), "a.png");
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("STORAGE_ERROR");
    expect(JSON.stringify(res.body)).not.toContain("storage down");
  });

  it("only ever writes inside the caller's own folder", async () => {
    const { as, alice, bob, state } = setup();
    await as(bob).post("/api/v1/me/avatar").attach("avatar", await pngFixture(), "a.png");
    for (const key of state.objects.keys()) expect(key.startsWith(`avatars/${bob.user.id}/`)).toBe(true);
    expect(state.profiles.get(alice.user.id).avatar_path).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("DELETE /api/v1/me/avatar", () => {
  it("deletes the stored object and clears avatar_path", async () => {
    const { as, alice, state } = setup();
    await as(alice).post("/api/v1/me/avatar").attach("avatar", await pngFixture(), "a.png");
    const path = state.profiles.get(alice.user.id).avatar_path;
    const res = await as(alice).delete("/api/v1/me/avatar");
    expect(res.status).toBe(200);
    expect(res.body.data.profile.avatar_url).toBeNull();
    expect(state.objects.has(`avatars/${path}`)).toBe(false);
    expect(state.profiles.get(alice.user.id).avatar_path).toBeNull();
  });

  it("is idempotent when there is no avatar", async () => {
    const { as, alice, state } = setup();
    const res = await as(alice).delete("/api/v1/me/avatar");
    expect(res.status).toBe(200);
    expect(state.calls.some((c) => c.op === "storage.remove")).toBe(false);
  });

  it("keeps avatar_path and surfaces 502 when the object cannot be removed", async () => {
    const { as, alice, state } = setup();
    await as(alice).post("/api/v1/me/avatar").attach("avatar", await pngFixture(), "a.png");
    const path = state.profiles.get(alice.user.id).avatar_path;
    state.fail.remove = true;
    const res = await as(alice).delete("/api/v1/me/avatar");
    expect(res.status).toBe(502);
    expect(state.profiles.get(alice.user.id).avatar_path).toBe(path);
  });

  it("cannot affect another user's avatar", async () => {
    const { as, alice, bob, state } = setup();
    await as(alice).post("/api/v1/me/avatar").attach("avatar", await pngFixture(), "a.png");
    const alicePath = state.profiles.get(alice.user.id).avatar_path;
    await as(bob).delete("/api/v1/me/avatar");
    expect(state.objects.has(`avatars/${alicePath}`)).toBe(true);
    expect(state.profiles.get(alice.user.id).avatar_path).toBe(alicePath);
  });
});
