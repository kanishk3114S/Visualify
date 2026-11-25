/**
 * Incremental Server-Sent Events parser (WHATWG event-stream format).
 * Used with fetch() + ReadableStream because EventSource cannot send an
 * Authorization header, and tokens must never go in a URL.
 *
 * feed(chunk) returns the complete events contained so far; partial lines are
 * buffered until the next chunk. Comment lines (": heartbeat") are ignored.
 */
export function createSseParser() {
  let buffer = "";
  let data = [];
  let type = "";
  let id = null;
  let retry = null;

  function dispatch(out) {
    if (data.length > 0) out.push({ type: type || "message", data: data.join("\n"), id });
    data = [];
    type = "";
  }

  return {
    feed(chunk) {
      buffer += chunk;
      const out = [];
      let newline;
      while ((newline = buffer.search(/\r\n|\r|\n/)) !== -1) {
        const line = buffer.slice(0, newline);
        const sepLength = buffer.startsWith("\r\n", newline) ? 2 : 1;
        // A lone trailing "\r" may be the first half of "\r\n": wait for more.
        if (buffer[newline] === "\r" && sepLength === 1 && newline === buffer.length - 1) break;
        buffer = buffer.slice(newline + sepLength);
        if (line === "") {
          dispatch(out);
          continue;
        }
        if (line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? "" : line.slice(colon + 1);
        if (value.startsWith(" ")) value = value.slice(1);
        if (field === "data") data.push(value);
        else if (field === "event") type = value;
        else if (field === "id" && !value.includes("\0")) id = value;
        else if (field === "retry" && /^\d+$/.test(value)) retry = Number(value);
      }
      return out;
    },
    /** End of stream: a held trailing "\r" is a line break, not half of "\r\n". */
    flush() {
      if (buffer.endsWith("\r")) buffer = `${buffer.slice(0, -1)}\n`;
      return buffer ? this.feed("") : [];
    },
    get retry() {
      return retry;
    },
  };
}

/**
 * Reads an SSE response body, invoking onEvent({ type, data: parsedJson, id })
 * for each event. Resolves when the stream ends; rejects on network errors.
 */
export async function readSseStream(body, onEvent, { signal } = {}) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();
  const onAbort = () => reader.cancel().catch(() => {});
  signal?.addEventListener("abort", onAbort, { once: true });
  const emit = (events) => {
    for (const event of events) {
      let parsed;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        continue; // ignore malformed payloads
      }
      onEvent({ type: event.type, data: parsed, id: event.id });
    }
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        emit(parser.feed(decoder.decode()));
        emit(parser.flush());
        break;
      }
      emit(parser.feed(decoder.decode(value, { stream: true })));
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}
