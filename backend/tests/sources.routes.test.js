import { describe, it, expect } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { buildTestApp } from "./helpers/testApp.js";
import { jpegWithExifFixture, pngFixture } from "./helpers/images.js";

const UNKNOWN_ID = "6f1c2c1e-1111-4a4a-8b8b-123456789abc";

function makeMinimalPdf(pageTexts = ["Page 1: TCP establishes connections via SYN, SYN-ACK, ACK."]) {
  const esc = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const objects = [];
  const pageCount = pageTexts.length;
  const pageIds = [];
  const contentIds = [];
  let nextId = 4;
  for (let i = 0; i < pageCount; i++) {
    pageIds.push(nextId++);
    contentIds.push(nextId++);
  }
  objects[1] = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
  objects[2] = `2 0 obj\n<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>\nendobj\n`;
  objects[3] = `3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`;
  for (let i = 0; i < pageCount; i++) {
    const streamBody = `BT\n/F1 12 Tf\n72 720 Td\n(${esc(pageTexts[i])}) Tj\nET\n`;
    objects[pageIds[i]] = `${pageIds[i]} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentIds[i]} 0 R >>\nendobj\n`;
    objects[contentIds[i]] = `${contentIds[i]} 0 obj\n<< /Length ${Buffer.byteLength(streamBody, "utf8")} >>\nstream\n${streamBody}endstream\nendobj\n`;
  }
  const chunks = ["%PDF-1.4\n"];
  const offsets = [0];
  let byteOffset = Buffer.byteLength(chunks[0], "utf8");
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = byteOffset;
    chunks.push(objects[id]);
    byteOffset += Buffer.byteLength(objects[id], "utf8");
  }
  const xrefPos = byteOffset;
  let xref = `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) xref += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  const trailer = `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(chunks.join("") + xref + trailer, "utf8");
}

function setup(envOverrides) {
  const ctx = buildTestApp(envOverrides);
  const alice = ctx.addUser({ email: "alice@example.test" });
  const bob = ctx.addUser({ email: "bob@example.test" });
  const as = (who) => ({
    get: (url) => request(ctx.app).get(url).set("Authorization", `Bearer ${who.token}`),
    post: (url) => request(ctx.app).post(url).set("Authorization", `Bearer ${who.token}`),
    delete: (url) => request(ctx.app).delete(url).set("Authorization", `Bearer ${who.token}`),
  });
  return { ...ctx, alice, bob, as };
}

describe("Phase 4: /api/v1/sources", () => {
  it("requires authentication before parsing multipart uploads", async () => {
    const { app } = setup();
    const res = await request(app).post("/api/v1/sources/upload").attach("file", makeMinimalPdf(), "notes.pdf");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("uploads a valid PDF, records pageCount, stores under uid/sourceFileId, and hides internal fields", async () => {
    const { as, alice, state } = setup();
    const pdf = makeMinimalPdf(["Page 1", "Page 2", "Page 3"]);
    const res = await as(alice).post("/api/v1/sources/upload").attach("file", pdf, "Networking Slides.pdf");
    expect(res.status).toBe(201);
    const sf = res.body.data.sourceFile;
    expect(sf).toMatchObject({
      id: expect.any(String),
      originalName: "Networking Slides.pdf",
      mimeType: "application/pdf",
      pageCount: 3,
      width: null,
      height: null,
      previewUrl: null,
      extractionStatus: "uploaded",
    });
    expect(sf).not.toHaveProperty("owner_id");
    expect(sf).not.toHaveProperty("object_path");
    expect(sf).not.toHaveProperty("checksum");

    const row = state.sourceFiles.get(sf.id);
    expect(row.object_path).toBe(`${alice.user.id}/${sf.id}/original.pdf`);
    expect(state.objects.has(`source-files/${row.object_path}`)).toBe(true);
  });

  it("uploads an image, strips EXIF, auto-orients, and returns a signed preview URL", async () => {
    const { as, alice, state } = setup();
    const jpg = await jpegWithExifFixture();
    const res = await as(alice).post("/api/v1/sources/upload").attach("file", jpg, "handwritten.jpg");
    expect(res.status).toBe(201);
    const sf = res.body.data.sourceFile;
    expect(sf.mimeType).toBe("image/jpeg");
    expect([sf.width, sf.height]).toEqual([200, 400]); // rotated from 400x200
    expect(sf.previewUrl).toMatch(/^https:\/\/fake\.supabase\.test\/storage\/v1\/object\/sign\/source-files\//);

    const stored = state.objects.get(`source-files/${state.sourceFiles.get(sf.id).object_path}`);
    expect(stored.buffer.includes(Buffer.from("SECRET-EXIF-MARKER"))).toBe(false);
    const meta = await sharp(stored.buffer).metadata();
    expect(meta.exif).toBeUndefined();
  });

  it("rejects spoofed extensions/MIME types, corrupt PDFs, and oversized uploads", async () => {
    const { as, alice, state } = setup({ SOURCE_MAX_BYTES: "4096" });
    const fakePdf = await as(alice)
      .post("/api/v1/sources/upload")
      .attach("file", Buffer.from("<html><script>alert(1)</script></html>"), { filename: "evil.pdf", contentType: "application/pdf" });
    expect(fakePdf.status).toBe(415);
    expect(fakePdf.body.error.code).toBe("UNSUPPORTED_FILE_TYPE");

    const corruptPdf = await as(alice)
      .post("/api/v1/sources/upload")
      .attach("file", Buffer.from("%PDF-1.7\ncorrupt"), "bad.pdf");
    expect(corruptPdf.status).toBe(422);
    expect(corruptPdf.body.error.code).toBe("CORRUPT_FILE");

    const bigPng = await pngFixture(800, 800);
    const tooBig = await as(alice).post("/api/v1/sources/upload").attach("file", bigPng, "big.png");
    expect(tooBig.status).toBe(413);
    expect(tooBig.body.error.code).toBe("FILE_TOO_LARGE");
    expect(state.sourceFiles.size).toBe(0);
  });

  it("enforces ownership on GET and DELETE (same 404 for foreign/unknown/malformed IDs)", async () => {
    const { as, alice, bob, state } = setup();
    const up = await as(alice).post("/api/v1/sources/upload").attach("file", await pngFixture(), "notes.png");
    const id = up.body.data.sourceFile.id;

    for (const bad of [id, UNKNOWN_ID, "not-a-uuid"]) {
      const g = await as(bob).get(`/api/v1/sources/${bad}`);
      expect(g.status).toBe(404);
      const d = await as(bob).delete(`/api/v1/sources/${bad}`);
      expect(d.status).toBe(404);
    }

    const mine = await as(alice).get(`/api/v1/sources/${id}`);
    expect(mine.status).toBe(200);
    expect(mine.body.data.sourceFile.id).toBe(id);

    const del = await as(alice).delete(`/api/v1/sources/${id}`);
    expect(del.status).toBe(200);
    expect(del.body.data.deleted).toBe(true);
    expect(state.sourceFiles.has(id)).toBe(false);
    expect(state.objects.size).toBe(0);
  });

  it("rate-limits source uploads per user", async () => {
    const { as, alice, bob } = setup();
    const pdf = makeMinimalPdf();
    let last;
    for (let i = 0; i < 31; i += 1) {
      last = await as(alice).post("/api/v1/sources/upload").attach("file", pdf, `p${i}.pdf`);
    }
    expect(last.status).toBe(429);
    expect(last.body.error.code).toBe("RATE_LIMITED");
    expect((await as(bob).post("/api/v1/sources/upload").attach("file", pdf, "bob.pdf")).status).toBe(201);
  });
});

describe("Phase 4: PDF & image generation pipeline + note saving", () => {
  it("runs PDF generation through extracting -> planning -> composing and saves note with sourceType='pdf'", async () => {
    const { as, alice, generation } = setup();
    const pdf = makeMinimalPdf(["Page 1", "Page 2", "Page 3"]);
    const up = await as(alice).post("/api/v1/sources/upload").attach("file", pdf, "slides.pdf");
    const sourceFileId = up.body.data.sourceFile.id;

    const gen = await as(alice).post("/api/v1/generations").send({
      inputType: "pdf",
      sourceFileId,
      pageRange: { startPage: 1, endPage: 2 },
      prompt: "Focus on page 2",
      settings: { visualStyle: "editorial_color" },
    });
    expect(gen.status).toBe(202);
    await generation.service.onIdle();

    const jobRes = await as(alice).get(`/api/v1/generations/${gen.body.data.jobId}`);
    expect(jobRes.status).toBe(200);
    expect(jobRes.body.data.job).toMatchObject({
      status: "completed",
      inputType: "pdf",
      sourceFileId,
      pageRange: { startPage: 1, endPage: 2 },
      sourceFile: { id: sourceFileId, originalName: "slides.pdf", pageCount: 3 },
    });

    const extractCall = generation.pipelineDeps.calls.find((c) => c.op === "extract");
    expect(extractCall).toMatchObject({ inputType: "pdf", sourceFileId, pageRange: { startPage: 1, endPage: 2 } });

    const noteRes = await as(alice).post("/api/v1/notes").send({ jobId: gen.body.data.jobId });
    expect(noteRes.status).toBe(201);
    expect(noteRes.body.data.note.sourceType).toBe("pdf");
  });

  it("blocks cross-user sourceFileId and out-of-bounds PDF pageRange before enqueueing", async () => {
    const { as, alice, bob, generation } = setup();
    const pdf = makeMinimalPdf(["One", "Two"]);
    const up = await as(alice).post("/api/v1/sources/upload").attach("file", pdf, "a.pdf");
    const sfId = up.body.data.sourceFile.id;

    const foreign = await as(bob).post("/api/v1/generations").send({ inputType: "pdf", sourceFileId: sfId });
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe("SOURCE_NOT_FOUND");

    const badPages = await as(alice).post("/api/v1/generations").send({
      inputType: "pdf",
      sourceFileId: sfId,
      pageRange: { startPage: 1, endPage: 5 },
    });
    expect(badPages.status).toBe(400);
    expect(badPages.body.error.code).toBe("INVALID_PAGE_RANGE");
    expect(generation.store.rows.size).toBe(0);
  });

  it("maps extraction failures (ENCRYPTED_PDF, CORRUPT_FILE) to safe job errors", async () => {
    const { as, alice, generation } = setup();
    const up = await as(alice).post("/api/v1/sources/upload").attach("file", makeMinimalPdf(), "enc.pdf");
    generation.pipelineDeps.extractError = Object.assign(new Error("PasswordException: internal stack"), { code: "ENCRYPTED_PDF" });
    const gen = await as(alice).post("/api/v1/generations").send({
      inputType: "pdf",
      sourceFileId: up.body.data.sourceFile.id,
    });
    await generation.service.onIdle();
    const jobRes = await as(alice).get(`/api/v1/generations/${gen.body.data.jobId}`);
    expect(jobRes.body.data.job.status).toBe("failed");
    expect(jobRes.body.data.job.safeError.code).toBe("ENCRYPTED_PDF");
    expect(JSON.stringify(jobRes.body)).not.toContain("PasswordException");
  });
});
