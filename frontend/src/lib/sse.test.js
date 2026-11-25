import { describe, it, expect } from "vitest";
import { createSseParser, readSseStream } from "./sse.js";

describe("createSseParser", () => {
  it("parses named events with JSON data and ids", () => {
    const p = createSseParser();
    const events = p.feed('id: 1\nevent: stage\ndata: {"status":"planning","progress":12}\n\n');
    expect(events).toEqual([{ type: "stage", data: '{"status":"planning","progress":12}', id: "1" }]);
  });

  it("buffers events split across arbitrary chunk boundaries", () => {
    const p = createSseParser();
    const stream = 'event: progress\ndata: {"progress":20}\n\nevent: completed\ndata: {"status":"completed"}\n\n';
    const out = [];
    for (const ch of stream) out.push(...p.feed(ch));
    expect(out.map((e) => e.type)).toEqual(["progress", "completed"]);
    expect(JSON.parse(out[1].data)).toEqual({ status: "completed" });
  });

  it("ignores heartbeat comments and handles CRLF / CR line endings", () => {
    const p = createSseParser();
    const out = p.feed(': heartbeat\r\n\r\nevent: snapshot\r\ndata: {"a":1}\r\n\r\n: heartbeat\r\revent: stage\rdata: {"b":2}\r\r');
    // The final lone "\r" could still be half of "\r\n" until the stream ends.
    expect(out.map((e) => e.type)).toEqual(["snapshot"]);
    expect(p.flush().map((e) => e.type)).toEqual(["stage"]);
  });

  it("does not split a CRLF that arrives across two chunks", () => {
    const p = createSseParser();
    expect(p.feed('event: x\r\ndata: {"a":1}\r')).toEqual([]);
    expect(p.feed("\n\r\n")).toEqual([{ type: "x", data: '{"a":1}', id: null }]);
  });

  it("joins multi-line data and defaults the type to message", () => {
    const p = createSseParser();
    expect(p.feed("data: line1\ndata: line2\n\n")).toEqual([{ type: "message", data: "line1\nline2", id: null }]);
  });

  it("records the retry interval and skips events with no data", () => {
    const p = createSseParser();
    expect(p.feed("retry: 3000\n\nevent: empty\n\n")).toEqual([]);
    expect(p.retry).toBe(3000);
  });
});

describe("readSseStream", () => {
  const body = (chunks) =>
    new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        for (const c of chunks) controller.enqueue(enc.encode(c));
        controller.close();
      },
    });

  it("decodes, parses JSON payloads and skips malformed ones", async () => {
    const seen = [];
    await readSseStream(
      body(['event: snapshot\ndata: {"status":"queued","progress":0}\n\n', "event: bad\ndata: {not json\n\n", 'event: completed\ndata: {"status":"completed","progress":100}\n\n']),
      (e) => seen.push(e)
    );
    expect(seen).toEqual([
      { type: "snapshot", data: { status: "queued", progress: 0 }, id: null },
      { type: "completed", data: { status: "completed", progress: 100 }, id: null },
    ]);
  });

  it("handles multi-byte UTF-8 split across chunks", async () => {
    const bytes = new TextEncoder().encode('event: stage\ndata: {"label":"Größe ✓"}\n\n');
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(bytes.slice(0, 30));
        c.enqueue(bytes.slice(30));
        c.close();
      },
    });
    const seen = [];
    await readSseStream(stream, (e) => seen.push(e));
    expect(seen[0].data.label).toBe("Größe ✓");
  });

  it("stops reading when aborted", async () => {
    const ac = new AbortController();
    const stream = new ReadableStream({ start() {} }); // never closes
    const pending = readSseStream(stream, () => {}, { signal: ac.signal });
    ac.abort();
    await expect(pending).resolves.toBeUndefined();
  });
});
