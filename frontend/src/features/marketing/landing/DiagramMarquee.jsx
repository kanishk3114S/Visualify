import { useState } from "react";
import { Pause, Play } from "lucide-react";
import { Reveal } from "../../../motion/Reveal.jsx";
import { useReducedMotion } from "../../../motion/useReducedMotion.js";

const GALLERY = [
  { src: "/diagrams/diagram-mindmap.webp", label: "Mind Map", title: "Hierarchical Concept Branches" },
  { src: "/diagrams/diagram-sequence.webp", label: "Sequence", title: "Protocol Message Lifelines" },
  { src: "/diagrams/diagram-er.webp", label: "ER Diagram", title: "Database Entities & Keys" },
  { src: "/diagrams/diagram-comparison.webp", label: "Comparison", title: "Structured Trade-off Matrix" },
];

/**
 * Continuous diagram gallery strip using real rendered WebP outputs.
 * Meets WCAG 2.2.2 (Pause, Stop, Hide): pauses on hover/focus, includes explicit Pause button,
 * and falls back cleanly to a static responsive grid under `prefers-reduced-motion: reduce`.
 */
export function DiagramMarquee() {
  const reducedMotion = useReducedMotion();
  const [paused, setPaused] = useState(false);

  return (
    <section className="border-y border-stone-200 bg-surface py-14" aria-labelledby="gallery-heading">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal y={10} className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-accent-700">Real rendered outputs</p>
            <h2 id="gallery-heading" className="mt-1.5 font-display text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">
              Seven diagram families engineered for clarity
            </h2>
          </div>

          {!reducedMotion && (
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              aria-pressed={paused}
              className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-surface px-3 py-1.5 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-100 hover:text-stone-900"
            >
              {paused ? <Play className="h-3.5 w-3.5" aria-hidden="true" /> : <Pause className="h-3.5 w-3.5" aria-hidden="true" />}
              {paused ? "Resume gallery" : "Pause gallery"}
            </button>
          )}
        </Reveal>
      </div>

      {reducedMotion ? (
        <div className="mx-auto mt-8 grid max-w-6xl gap-4 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          {GALLERY.map((item) => (
            <figure key={item.label} className="overflow-hidden rounded-xl border border-stone-200 bg-canvas p-3">
              <img
                src={item.src}
                alt={`${item.label}: ${item.title}`}
                width={960}
                height={600}
                loading="lazy"
                decoding="async"
                className="aspect-[16/10] w-full rounded-lg border border-stone-200 bg-white object-contain"
              />
              <figcaption className="mt-2.5 flex items-center justify-between text-xs">
                <span className="font-semibold text-stone-900">{item.label}</span>
                <span className="truncate text-stone-600">{item.title}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <div
          className="vf-marquee-wrap mt-8 overflow-hidden"
          data-paused={paused ? "true" : "false"}
        >
          <div className="vf-marquee-track gap-5 px-4">
            {[...GALLERY, ...GALLERY].map((item, idx) => (
              <figure
                key={`${item.label}-${idx}`}
                aria-hidden={idx >= GALLERY.length || undefined}
                className="w-72 shrink-0 overflow-hidden rounded-2xl border border-stone-200 bg-canvas p-3 sm:w-80"
              >
                <img
                  src={item.src}
                  alt={idx < GALLERY.length ? `${item.label}: ${item.title}` : ""}
                  width={960}
                  height={600}
                  loading="lazy"
                  decoding="async"
                  className="aspect-[16/10] w-full rounded-lg border border-stone-200 bg-white object-contain"
                />
                <figcaption className="mt-2.5 flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-stone-900">{item.label}</span>
                  <span className="truncate text-stone-600">{item.title}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
