import { useState } from "react";
import clsx from "clsx";
import { ArrowRight, CheckCircle2, FileText, GitBranch, Image as ImageIcon, Layers, Moon, Network, PenTool, Sparkles, Sun, Table2 } from "lucide-react";
import { ButtonLink } from "../../components/Button.jsx";
import { Badge } from "../../components/Layout.jsx";
import { SegmentedControl } from "../../components/SegmentedControl.jsx";

const DIAGRAMS = {
  sequence: {
    label: "Sequence",
    icon: ArrowRight,
    title: "TCP three-way handshake",
    caption: "Click a participant or step to inspect what happens at that point in the protocol.",
    nodes: [
      { id: "client", title: "Client", tone: "teal", detail: "The client initiates by picking an initial sequence number (seq = x) and entering SYN-SENT." },
      { id: "syn", title: "1. SYN (seq=x)", tone: "indigo", detail: "Synchronize packet tells the server the client wants to open a reliable byte stream." },
      { id: "synack", title: "2. SYN-ACK (seq=y, ack=x+1)", tone: "amber", detail: "Server acknowledges the client's sequence number (x+1) and advertises its own (y)." },
      { id: "server", title: "Server", tone: "rose", detail: "Once ACK arrives, both endpoints move to ESTABLISHED and application data can flow." },
    ],
  },
  flowchart: {
    label: "Flowchart",
    icon: GitBranch,
    title: "Express request validation",
    caption: "Decision nodes branch cleanly with semantic color coding.",
    nodes: [
      { id: "spa", title: "React SPA", tone: "teal", detail: "Sends Bearer JWT and JSON payload over HTTPS." },
      { id: "auth", title: "Verify JWT", tone: "indigo", detail: "Auth middleware resolves user identity before parsing the request body." },
      { id: "zod", title: "Zod Valid?", tone: "amber", detail: "Decision branch rejects malformed fields early with 400 VALIDATION_ERROR." },
      { id: "ok", title: "202 Queued", tone: "emerald", detail: "Valid jobs enqueue asynchronously and stream progress over SSE." },
    ],
  },
  mindmap: {
    label: "Mind map",
    icon: Network,
    title: "Operating system kernel",
    caption: "Balanced central topic with color-coded branches and leaf concepts.",
    nodes: [
      { id: "os", title: "OS Kernel", tone: "teal", detail: "Coordinates hardware access, isolation, and fair scheduling across processes." },
      { id: "proc", title: "Processes", tone: "indigo", detail: "Time-sharing scheduler, context switches, threads, and mutex synchronization." },
      { id: "mem", title: "Virtual Memory", tone: "amber", detail: "Page tables, TLB caching, and copy-on-write isolation per process." },
      { id: "fs", title: "Storage & I/O", tone: "emerald", detail: "Buffered block devices, virtual file system, and interrupt-driven drivers." },
    ],
  },
  comparison: {
    label: "Comparison",
    icon: Table2,
    title: "SQL vs NoSQL databases",
    caption: "Side-by-side columns align trade-offs and summarize key takeaways.",
    nodes: [
      { id: "schema", title: "Schema", tone: "teal", detail: "SQL enforces normalized tables & foreign keys; NoSQL stores flexible JSON documents." },
      { id: "acid", title: "Transactions", tone: "indigo", detail: "SQL provides multi-row ACID; NoSQL trades cross-shard joins for horizontal throughput." },
      { id: "scale", title: "Scaling", tone: "amber", detail: "SQL scales vertically + read replicas; NoSQL shards horizontally across commodity nodes." },
      { id: "takeaway", title: "Key Takeaway", tone: "rose", detail: "Choose SQL for relational integrity & complex queries; NoSQL for high-write document feeds." },
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
 * Interactive multi-diagram showcase: learners can switch diagram formats,
 * click nodes to inspect live explanations, and toggle Light/Dark canvas preview.
 */
function SampleVisual() {
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
      className="animate-fade-up rounded-2xl border border-stone-200 bg-surface p-4 shadow-sm sm:p-5"
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
          "relative rounded-xl border p-4",
          darkCard ? "border-stone-700 bg-[#161513] text-[#f5f3f1]" : "border-stone-300 bg-[#faf8f5] text-[#1c1917]"
        )}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold tracking-wide uppercase">{diagram.title}</p>
          <span className={clsx("text-[11px]", darkCard ? "text-[#d6d3d1]" : "text-[#57534e]")}>Click a node</span>
        </div>

        {/* Interactive layout tailored per diagram family */}
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
          <span className="font-semibold">{activeNode.title}:</span> {activeNode.detail}
        </div>
      </div>

      <figcaption className="mt-3 flex items-center justify-between gap-2 text-xs text-stone-600">
        <span>{diagram.caption}</span>
        <span className="hidden items-center gap-1 text-accent-700 sm:inline-flex">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          Editable in Excalidraw
        </span>
      </figcaption>
    </figure>
  );
}

const PILLARS = [
  { icon: Sparkles, title: "Explained, not just drawn", text: "Each visual comes with a clear overview, learning objectives, and section-by-section explanation." },
  { icon: PenTool, title: "Fully editable", text: "Bound labels and connectors open in Excalidraw so dragging a box moves its arrows and text too." },
  { icon: Layers, title: "7 structured diagram types", text: "Flowcharts, sequences, mind maps, comparisons, timelines, ER and class diagrams." },
  { icon: FileText, title: "Prompts, PDFs & note photos", text: "Paste a topic, upload lecture PDFs with page selection, or snap handwritten notes." },
];

export function LandingPage() {
  return (
    <>
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-2 lg:py-20">
        <div className="animate-fade-up space-y-6">
          <Badge tone="accent">
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            Prompts, PDFs &amp; images
          </Badge>
          <h1 className="text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl">
            Turn study topics, PDFs and notes into visual notes you can edit.
          </h1>
          <p className="max-w-xl text-base leading-relaxed text-stone-600">
            Visualify is a visual learning workspace: bring a topic, lecture PDF or photo of handwritten notes, and
            leave with an editable diagram and structured explanation.
          </p>
          <div className="flex flex-wrap gap-3">
            <ButtonLink to="/signup" size="lg">
              Create a free account
            </ButtonLink>
            <ButtonLink to="/features" variant="secondary" size="lg">
              See what's included
            </ButtonLink>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs text-stone-600">
            <span className="inline-flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5 text-accent-700" aria-hidden="true" />
              PDF page selection
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ImageIcon className="h-3.5 w-3.5 text-accent-700" aria-hidden="true" />
              Handwritten note photos
            </span>
            <span className="inline-flex items-center gap-1.5">
              <PenTool className="h-3.5 w-3.5 text-accent-700" aria-hidden="true" />
              PNG, SVG &amp; .excalidraw export
            </span>
          </div>
        </div>
        <SampleVisual />
      </section>

      <section className="border-t border-stone-200 bg-surface" aria-labelledby="how-heading">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2 id="how-heading" className="text-xl font-semibold tracking-tight text-stone-900">
            Built for understanding
          </h2>
          <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {PILLARS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="space-y-2 rounded-xl border border-stone-200/80 bg-canvas/50 p-4">
                <Icon className="h-5 w-5 text-accent-700" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-stone-900">{title}</h3>
                <p className="text-sm leading-relaxed text-stone-600">{text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
