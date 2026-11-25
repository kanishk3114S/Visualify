import { Badge } from "../../components/Layout.jsx";
import { ButtonLink } from "../../components/Button.jsx";

// Release policy (PRD 4): only what is actually live is labelled "Available now".
const FEATURES = [
  { title: "Accounts", text: "Email and password or Google sign-in, email verification and password recovery.", status: "now" },
  { title: "Profile", text: "Display name, username, bio and a private profile photo.", status: "now" },
  { title: "Prompt to visual notes", text: "Describe a topic and receive an editable diagram with an explanation.", status: "next" },
  { title: "Canvas editor", text: "Edit generated diagrams in an Excalidraw-based canvas with autosave.", status: "next" },
  { title: "Notes library", text: "Folders, tags, search, favourites and version history.", status: "next" },
  { title: "Downloads", text: "Export notes as PNG, SVG or .excalidraw files.", status: "next" },
  { title: "PDF and image inputs", text: "Generate visuals from lecture PDFs, slides and photos of handwritten notes.", status: "later" },
  { title: "Learning tools", text: "Presentation mode, explain-this-element, quizzes and flashcards.", status: "later" },
];

const STATUS = {
  now: { label: "Available now", tone: "accent" },
  next: { label: "Coming next", tone: "soon" },
  later: { label: "Coming later", tone: "neutral" },
};

const VISUAL_TYPES = ["Flowcharts", "Sequence diagrams", "Mind maps", "Comparisons", "Timelines", "Entity-relationship diagrams", "Class diagrams"];

export function FeaturesPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-14 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight text-stone-900">Features</h1>
      <p className="mt-3 max-w-2xl text-stone-600">
        Visualify is in early access. Here's exactly what you can use today and what's on the way.
      </p>

      <ul className="mt-10 divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white">
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

      <section className="mt-12" aria-labelledby="formats">
        <h2 id="formats" className="text-lg font-semibold text-stone-900">
          Planned visual types
        </h2>
        <p className="mt-2 text-sm text-stone-600">Each type has been prototyped with the rendering pipeline.</p>
        <ul className="mt-4 flex flex-wrap gap-2">
          {VISUAL_TYPES.map((t) => (
            <li key={t} className="rounded-full border border-stone-200 bg-white px-3 py-1 text-sm text-stone-700">
              {t}
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-12">
        <ButtonLink to="/signup" size="lg">
          Create a free account
        </ButtonLink>
      </div>
    </div>
  );
}
