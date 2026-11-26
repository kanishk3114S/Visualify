import { Badge } from "../../components/Layout.jsx";
import { ButtonLink } from "../../components/Button.jsx";
import { Reveal } from "../../motion/Reveal.jsx";

// Release policy (PRD 4): only what is actually live is labelled "Available now".
const FEATURES = [
  { title: "Accounts", text: "Email and password or Google sign-in, email verification and password recovery.", status: "now" },
  { title: "Profile", text: "Display name, username, bio and a private profile photo.", status: "now" },
  { title: "Prompt to visual notes", text: "Describe a topic and receive an editable diagram with a section-by-section explanation.", status: "now" },
  { title: "PDF and image inputs", text: "Upload lecture PDFs (with page-range selection) and photos of handwritten or printed notes with source page citations.", status: "now" },
  { title: "Canvas editor", text: "Edit generated diagrams with bound labels and connectors in an Excalidraw-based canvas.", status: "now" },
  { title: "Autosave and versions", text: "Edits save automatically; snapshots and restorable version history.", status: "now" },
  { title: "Notes library", text: "Folders, tags, source badges, search, favourites, archive and grid/list views.", status: "now" },
  { title: "Downloads", text: "Export full boards or selections as PNG, SVG or .excalidraw files, in light or dark.", status: "now" },
  { title: "Dark mode", text: "Light, dark or match-your-device themes across every page.", status: "now" },
  { title: "Learning tools", text: "Presentation mode, explain-this-element, quizzes, flashcards, revision sheets and Ask your notes.", status: "now" },
  { title: "Sharing & workspaces", text: "Read-only share links, curated study collections and cross-note Q&A (Phase 7).", status: "later" },
];

const STATUS = {
  now: { label: "Available now", tone: "accent" },
  next: { label: "Coming next", tone: "soon" },
  later: { label: "Coming later", tone: "neutral" },
};

const VISUAL_TYPES = [
  { name: "Flowcharts", hint: "Processes, decisions, and branched workflows" },
  { name: "Sequence diagrams", hint: "Message exchanges between actors over time" },
  { name: "Mind maps", hint: "Central topics branching into subconcepts" },
  { name: "Comparisons", hint: "Side-by-side trade-offs and key takeaways" },
  { name: "Timelines", hint: "Chronological events and milestones" },
  { name: "Entity-relationship diagrams", hint: "Entities, attributes, and cardinalities" },
  { name: "Class diagrams", hint: "Classes, methods, and relationships" },
];

export function FeaturesPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-14 sm:px-6">
      <Reveal y={10}>
        <h1 className="font-display text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl">Features</h1>
        <p className="mt-3 max-w-2xl text-stone-600">
          Visualify turns prompts, PDFs and images into structured visual notes. Here&apos;s what&apos;s live today and what&apos;s planned next.
        </p>
      </Reveal>

      <Reveal delay={60} y={12}>
        <ul className="mt-10 divide-y divide-stone-200 rounded-xl border border-stone-200 bg-surface">
          {FEATURES.map((f) => (
            <li key={f.title} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
              <div>
                <h2 className="text-sm font-semibold text-stone-900">{f.title}</h2>
                <p className="mt-0.5 text-sm text-stone-600">{f.text}</p>
              </div>
              <Badge tone={STATUS[f.status].tone}>{STATUS[f.status].label}</Badge>
            </li>
          ))}
        </ul>
      </Reveal>

      <Reveal delay={100} y={12} as="section" className="mt-12" aria-labelledby="formats">
        <h2 id="formats" className="font-display text-xl font-semibold text-stone-900">
          Supported visual types
        </h2>
        <p className="mt-2 text-sm text-stone-600">Visualify selects the best fit automatically, or you can pick one on Create.</p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {VISUAL_TYPES.map((t) => (
            <li key={t.name} className="rounded-xl border border-stone-200 bg-surface px-4 py-3 transition-colors hover:border-stone-300">
              <p className="text-sm font-semibold text-stone-900">{t.name}</p>
              <p className="mt-0.5 text-xs text-stone-600">{t.hint}</p>
            </li>
          ))}
        </ul>
      </Reveal>

      <div className="mt-12">
        <ButtonLink to="/signup" size="lg">
          Create a free account
        </ButtonLink>
      </div>
    </div>
  );
}
