import { useState } from "react";
import clsx from "clsx";
import { ArrowRight, GitBranch, Moon, Network, Sun, Table2 } from "lucide-react";
import { SegmentedControl } from "../../../components/SegmentedControl.jsx";

const DIAGRAMS = {
  sequence: {
    label: "Sequence",
    icon: ArrowRight,
    title: "TCP three-way handshake",
    nodes: [
      { id: "client", title: "Client", tone: "teal", detail: "Client picks an initial sequence number (seq = x) and enters SYN-SENT." },
      { id: "syn", title: "1. SYN (seq=x)", tone: "indigo", detail: "Synchronize packet signals intent to open a reliable byte stream." },
      { id: "synack", title: "2. SYN-ACK (seq=y, ack=x+1)", tone: "amber", detail: "Server acknowledges client seq (x+1) and advertises its own (y)." },
      { id: "server", title: "Server", tone: "rose", detail: "After the final ACK, both endpoints transition to ESTABLISHED." },
    ],
  },
  flowchart: {
    label: "Flowchart",
    icon: GitBranch,
    title: "Express request validation",
    nodes: [
      { id: "spa", title: "React SPA", tone: "teal", detail: "Sends Bearer JWT and JSON payload over HTTPS." },
      { id: "auth", title: "Verify JWT", tone: "indigo", detail: "Auth middleware resolves user identity before parsing body fields." },
      { id: "zod", title: "Zod Valid?", tone: "amber", detail: "Decision branch rejects malformed input early with 400 VALIDATION_ERROR." },
      { id: "ok", title: "202 Queued", tone: "emerald", detail: "Valid jobs enqueue cleanly and stream stages over SSE." },
    ],
  },
  mindmap: {
    label: "Mind map",
    icon: Network,
    title: "Operating system kernel",
    nodes: [
      { id: "os", title: "OS Kernel", tone: "teal", detail: "Coordinates hardware access, isolation, and fair scheduling." },
      { id: "proc", title: "Processes", tone: "indigo", detail: "Time-sharing scheduler, context switches, threads, and mutexes." },
      { id: "mem", title: "Virtual Memory", tone: "amber", detail: "Page tables, TLB caching, and copy-on-write isolation." },
      { id: "fs", title: "Storage & I/O", tone: "emerald", detail: "Buffered block devices, virtual filesystem, and interrupt drivers." },
    ],
  },
  comparison: {
    label: "Comparison",
    icon: Table2,
    title: "SQL vs NoSQL databases",
    nodes: [
      { id: "schema", title: "Schema", tone: "teal", detail: "SQL enforces normalized relations; NoSQL stores flexible JSON documents." },
      { id: "acid", title: "Transactions", tone: "indigo", detail: "SQL gives multi-row ACID guarantees; NoSQL favors horizontal scale." },
      { id: "scale", title: "Scaling", tone: "amber", detail: "SQL scales vertically + read replicas; NoSQL shards horizontally." },
      { id: "takeaway", title: "Key Takeaway", tone: "rose", detail: "Choose SQL for relational integrity; NoSQL for high-write JSON feeds." },
    ],
  },
};

const NODE_TONES = {
  teal: "border-[#0f766e] bg-[#ccfbf1] text-[#0f172a]",
  indigo: "border-[#3730a3] bg-[#e0e7ff] text-[#0f172a]",
  amber: "border-[#b45309] bg-[#fef3c7] text-[#0f172a]",
  rose: "border-[#be123c] bg-[#ffe4e6] text-[#0f172a]",
  emerald: "border-[#047857] bg-[#d1fae5] text-[#0f172a]",
};

/**
 * Hero interactive multi-diagram showcase:
 * - Animated sketch-to-diagram badge bar
 * - Preserves format switcher, clickable nodes, live callout, and light/dark canvas toggle
 *   without pulling the full Excalidraw editor bundle into the marketing landing page.
 */
export function HeroStage() {
  const [kind, setKind] = useState("sequence");
  const [selectedId, setSelectedId] = useState(DIAGRAMS.sequence.nodes[0].id);
  const [cardTheme, setCardTheme] = useState("light");

  const diagram = DIAGRAMS[kind];
  const activeNode = diagram.nodes.find((n) => n.id === selectedId) ?? diagram.nodes[0];
  const darkCard = cardTheme === "dark";

  function switchKind(next) {
    setKind(next);
    setSelectedId(DIAGRAMS[next].nodes[0].id);
  }

  return (
    <figure
      className="rounded-2xl border border-hero-border bg-surface p-4 text-stone-900 shadow-2xl sm:p-5"
      data-testid="landing-showcase"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl
          label="Preview diagram type"
          size="sm"
          value={kind}
          onChange={switchKind}
          options={Object.entries(DIAGRAMS).map(([value, d]) => ({ value, label: d.label }))}
        />
        <button
          type="button"
          onClick={() => setCardTheme((t) => (t === "light" ? "dark" : "light"))}
          aria-label={`Switch preview canvas to ${darkCard ? "light" : "dark"} mode`}
          aria-pressed={darkCard}
          className="inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-surface px-2.5 py-1 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-100 hover:text-stone-900"
        >
          {darkCard ? <Sun className="h-3.5 w-3.5" aria-hidden="true" /> : <Moon className="h-3.5 w-3.5" aria-hidden="true" />}
          {darkCard ? "Light preview" : "Dark preview"}
        </button>
      </div>

      <div
        className={clsx(
          "relative rounded-xl border p-4 transition-colors duration-200",
          darkCard ? "border-stone-700 bg-[#161513] text-[#f5f3f1]" : "border-stone-300 bg-[#faf8f5] text-[#1c1917]"
        )}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 28 16" className="h-3.5 w-6 text-accent-600" aria-hidden="true">
              <path
                d="M2 8 Q8 2 14 8 T26 8"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            <p className="text-xs font-semibold uppercase tracking-wide">{diagram.title}</p>
          </div>
          <span className={clsx("text-[11px]", darkCard ? "text-[#d6d3d1]" : "text-[#57534e]")}>Click a node</span>
        </div>

        {kind === "sequence" && (
          <div className="space-y-2.5">
            <div className="grid grid-cols-2 gap-3">
              {[diagram.nodes[0], diagram.nodes[3]].map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => setSelectedId(n.id)}
                  aria-pressed={activeNode.id === n.id}
                  className={clsx(
                    "rounded-lg border-2 px-3 py-2 text-center text-xs font-semibold transition-all duration-150 active:scale-[0.98]",
                    NODE_TONES[n.tone],
                    activeNode.id === n.id && "ring-2 ring-accent-600 ring-offset-2"
                  )}
                >
                  {n.title}
                </button>
              ))}
            </div>
            <div className="space-y-2 px-2">
              {[diagram.nodes[1], diagram.nodes[2]].map((n, idx) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => setSelectedId(n.id)}
                  aria-pressed={activeNode.id === n.id}
                  className={clsx(
                    "flex w-full items-center justify-between rounded-md border px-3 py-1.5 text-left text-xs font-medium transition-all duration-150 active:scale-[0.99]",
                    NODE_TONES[n.tone],
                    activeNode.id === n.id && "ring-2 ring-accent-600 ring-offset-1"
                  )}
                >
                  <span>{idx === 0 ? "Client → Server" : "Server → Client"}</span>
                  <span className="font-semibold">{n.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {kind === "flowchart" && (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {diagram.nodes.map((n, idx) => (
              <button
                key={n.id}
                type="button"
                onClick={() => setSelectedId(n.id)}
                aria-pressed={activeNode.id === n.id}
                className={clsx(
                  "flex flex-col items-center justify-center gap-1 rounded-lg border-2 px-2.5 py-3 text-center text-xs font-semibold transition-all duration-150 active:scale-[0.98]",
                  NODE_TONES[n.tone],
                  activeNode.id === n.id && "ring-2 ring-accent-600 ring-offset-2"
                )}
              >
                <span className="text-[10px] font-medium opacity-75">Step {idx + 1}</span>
                <span>{n.title}</span>
              </button>
            ))}
          </div>
        )}

        {kind === "mindmap" && (
          <div className="grid gap-2.5 sm:grid-cols-[1fr_1.4fr] sm:items-center">
            <button
              type="button"
              onClick={() => setSelectedId(diagram.nodes[0].id)}
              aria-pressed={activeNode.id === diagram.nodes[0].id}
              className={clsx(
                "rounded-xl border-2 px-3 py-4 text-center text-xs font-semibold transition-all duration-150 active:scale-[0.98]",
                NODE_TONES[diagram.nodes[0].tone],
                activeNode.id === diagram.nodes[0].id && "ring-2 ring-accent-600 ring-offset-2"
              )}
            >
              <span className="block text-[10px] uppercase tracking-wider opacity-75">Central topic</span>
              <span className="mt-0.5 block text-sm">{diagram.nodes[0].title}</span>
            </button>
            <div className="space-y-2">
              {diagram.nodes.slice(1).map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => setSelectedId(n.id)}
                  aria-pressed={activeNode.id === n.id}
                  className={clsx(
                    "flex w-full items-center justify-between rounded-lg border-2 px-3 py-2 text-left text-xs font-semibold transition-all duration-150 active:scale-[0.99]",
                    NODE_TONES[n.tone],
                    activeNode.id === n.id && "ring-2 ring-accent-600 ring-offset-1"
                  )}
                >
                  <span>{n.title}</span>
                  <span className="text-[11px] font-normal opacity-80">Inspect →</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {kind === "comparison" && (
          <div className="grid grid-cols-2 gap-2.5">
            {diagram.nodes.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => setSelectedId(n.id)}
                aria-pressed={activeNode.id === n.id}
                className={clsx(
                  "rounded-lg border-2 px-3 py-2.5 text-left text-xs font-semibold transition-all duration-150 active:scale-[0.98]",
                  NODE_TONES[n.tone],
                  activeNode.id === n.id && "ring-2 ring-accent-600 ring-offset-1"
                )}
              >
                {n.title}
              </button>
            ))}
          </div>
        )}

        <div
          role="status"
          aria-live="polite"
          data-testid="showcase-callout"
          className={clsx(
            "mt-3 rounded-lg border px-3 py-2.5 text-xs leading-relaxed",
            darkCard ? "border-stone-700 bg-[#23201d] text-[#f5f3f1]" : "border-stone-200 bg-white text-[#292524]"
          )}
        >
          <span className="font-semibold">{activeNode.title}: </span>
          <span>{activeNode.detail}</span>
        </div>
      </div>

      <figcaption className="mt-2.5 flex items-center justify-between px-1 text-xs text-stone-600">
        <span>Interactive preview — real exports render editable Excalidraw canvases.</span>
        <span className="hidden font-medium text-accent-700 sm:inline">7 diagram families</span>
      </figcaption>
    </figure>
  );
}
