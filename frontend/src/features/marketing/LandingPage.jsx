import { FileText, Layers, PenTool, Sparkles } from "lucide-react";
import { ButtonLink } from "../../components/Button.jsx";
import { Badge } from "../../components/Layout.jsx";

/**
 * Static illustration of the kind of editable visual note Visualify produces
 * (a TCP handshake sequence). Decorative; the heading carries the meaning.
 */
function SampleVisual() {
  return (
    <figure className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6">
      <svg viewBox="0 0 420 260" className="h-auto w-full" role="img" aria-labelledby="sample-title sample-desc">
        <title id="sample-title">Sample visual note: TCP three-way handshake</title>
        <desc id="sample-desc">A client and a server exchange SYN, SYN-ACK and ACK messages before the connection is established.</desc>
        <g fontFamily="ui-sans-serif, system-ui, sans-serif" fontSize="13" fill="#1c1917">
          <rect x="30" y="16" width="110" height="38" rx="8" fill="#ccfbf1" stroke="#0f766e" strokeWidth="1.5" />
          <text x="85" y="40" textAnchor="middle" fontWeight="600">Client</text>
          <rect x="280" y="16" width="110" height="38" rx="8" fill="#fef3c7" stroke="#b45309" strokeWidth="1.5" />
          <text x="335" y="40" textAnchor="middle" fontWeight="600">Server</text>
          <line x1="85" y1="54" x2="85" y2="240" stroke="#a8a29e" strokeDasharray="4 4" />
          <line x1="335" y1="54" x2="335" y2="240" stroke="#a8a29e" strokeDasharray="4 4" />
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0L10 5L0 10z" fill="#44403c" />
            </marker>
          </defs>
          <line x1="88" y1="92" x2="330" y2="112" stroke="#44403c" strokeWidth="1.6" markerEnd="url(#arrow)" />
          <text x="210" y="84" textAnchor="middle">1. SYN (seq = x)</text>
          <line x1="332" y1="146" x2="90" y2="166" stroke="#44403c" strokeWidth="1.6" markerEnd="url(#arrow)" />
          <text x="210" y="138" textAnchor="middle">2. SYN-ACK (seq = y, ack = x+1)</text>
          <line x1="88" y1="200" x2="330" y2="220" stroke="#44403c" strokeWidth="1.6" markerEnd="url(#arrow)" />
          <text x="210" y="192" textAnchor="middle">3. ACK (ack = y+1)</text>
        </g>
      </svg>
      <figcaption className="mt-3 text-xs text-stone-500">Example of an editable diagram in a visual note.</figcaption>
    </figure>
  );
}

const PILLARS = [
  { icon: Sparkles, title: "Explained, not just drawn", text: "Each visual comes with a short explanation tuned to your level." },
  { icon: PenTool, title: "Fully editable", text: "Diagrams open in a hand-drawn style canvas you can rearrange and annotate." },
  { icon: Layers, title: "The right diagram for the idea", text: "Flowcharts, sequences, mind maps, timelines, comparisons and data models." },
  { icon: FileText, title: "From your own material", text: "Start from a prompt today; PDFs and photos of notes are planned next." },
];

export function LandingPage() {
  return (
    <>
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-2 lg:py-20">
        <div className="space-y-6">
          <Badge tone="accent">Early access</Badge>
          <h1 className="text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl">
            Turn study topics into visual notes you can edit.
          </h1>
          <p className="max-w-xl text-base leading-relaxed text-stone-600">
            Visualify is a visual learning workspace: it turns a concept into a clear, editable diagram with an
            explanation, so you understand it faster and remember it longer.
          </p>
          <div className="flex flex-wrap gap-3">
            <ButtonLink to="/signup" size="lg">
              Create a free account
            </ButtonLink>
            <ButtonLink to="/features" variant="secondary" size="lg">
              See what's included
            </ButtonLink>
          </div>
          <p className="text-sm text-stone-500">
            Prompt-to-visual generation is live. Saving notes to a library is coming next.
          </p>
        </div>
        <SampleVisual />
      </section>

      <section className="border-t border-stone-200 bg-white" aria-labelledby="how-heading">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2 id="how-heading" className="text-xl font-semibold tracking-tight text-stone-900">
            Built for understanding
          </h2>
          <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {PILLARS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="space-y-2">
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
