import { useState } from "react";
import clsx from "clsx";
import { Compass, GraduationCap, PenTool, Sparkles } from "lucide-react";
import { Reveal } from "../../../motion/Reveal.jsx";

const STEPS = [
  {
    id: "plan",
    number: "01",
    label: "Plan",
    icon: Sparkles,
    title: "AI plans structured sections",
    body: "Visualify analyzes your topic or PDF pages first — choosing the right visual family per section and building learning objectives before drawing a single shape.",
    previewSrc: "/diagrams/diagram-mindmap.webp",
    previewAlt: "Planned concept branches rendered cleanly as a mind map",
  },
  {
    id: "draw",
    number: "02",
    label: "Draw",
    icon: Compass,
    title: "Render a multi-section Excalidraw scene",
    body: "Each planned section compiles in bounded parallel workers with bound text containers, directional connectors, and color-coded semantic styling.",
    previewSrc: "/diagrams/diagram-sequence.webp",
    previewAlt: "Compiled sequence diagram with actors and numbered message arrows",
  },
  {
    id: "edit",
    number: "03",
    label: "Edit",
    icon: PenTool,
    title: "Customize shapes and explain selections",
    body: "Move boxes, edit labels, regenerate a single section, highlight canvas frames to ask 'Explain this selection', and snapshot restorable versions.",
    previewSrc: "/diagrams/diagram-er.webp",
    previewAlt: "Entity relationship diagram ready to inspect and customize on canvas",
  },
  {
    id: "study",
    number: "04",
    label: "Study",
    icon: GraduationCap,
    title: "Practice active recall from your notes",
    body: "Switch between Overview, Quiz, Flashcards, Revision sheet, Ask your note, and full-screen Presentation mode without leaving the note.",
    previewSrc: "/diagrams/diagram-comparison.webp",
    previewAlt: "Structured comparison visual synced with active recall tools",
  },
];

/** Interactive 4-stage Plan -> Draw -> Edit -> Study pipeline showcase. */
export function HowItWorks() {
  const [activeIdx, setActiveIdx] = useState(0);
  const current = STEPS[activeIdx];

  return (
    <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6" aria-labelledby="how-heading">
      <Reveal y={10}>
        <p className="text-xs font-semibold uppercase tracking-wider text-accent-700">How Visualify works</p>
        <h2 id="how-heading" className="mt-1.5 font-display text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">
          From raw notes to an interactive study kit in four stages
        </h2>
      </Reveal>

      <div className="mt-8 grid items-start gap-8 lg:grid-cols-12">
        <div className="space-y-2.5 lg:col-span-5" role="tablist" aria-label="Workflow stages">
          {STEPS.map((step, idx) => {
            const Icon = step.icon;
            const selected = idx === activeIdx;
            return (
              <button
                key={step.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveIdx(idx)}
                className={clsx(
                  "flex w-full items-start gap-3.5 rounded-2xl border p-4 text-left transition-[background-color,border-color,transform] duration-150 active:scale-[0.99]",
                  selected
                    ? "border-accent-700 bg-surface shadow-sm ring-1 ring-accent-700/20"
                    : "border-stone-200 bg-surface/60 hover:border-stone-300 hover:bg-surface"
                )}
              >
                <span
                  className={clsx(
                    "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold tabular-nums",
                    selected ? "bg-accent-700 text-on-accent" : "bg-stone-100 text-stone-700"
                  )}
                >
                  {step.number}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-semibold text-stone-900">
                    <Icon className={clsx("h-4 w-4", selected ? "text-accent-700" : "text-stone-500")} aria-hidden="true" />
                    {step.label}: {step.title}
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-stone-600">{step.body}</span>
                </span>
              </button>
            );
          })}
        </div>

        <Reveal delay={90} y={12} className="lg:col-span-7">
          <div className="overflow-hidden rounded-2xl border border-stone-200 bg-surface shadow-sm">
            <div className="flex items-center justify-between border-b border-stone-200 bg-stone-50 px-4 py-2.5 text-xs">
              <span className="font-semibold text-stone-800">
                Stage {current.number} — {current.label}
              </span>
              <span className="rounded-full bg-accent-50 px-2.5 py-0.5 font-medium text-accent-900">
                Real Excalidraw export preview
              </span>
            </div>
            <div className="aspect-[16/10] bg-canvas p-4">
              <img
                src={current.previewSrc}
                alt={current.previewAlt}
                width={960}
                height={600}
                loading="lazy"
                decoding="async"
                className="h-full w-full rounded-lg border border-stone-200 bg-white object-contain"
              />
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
