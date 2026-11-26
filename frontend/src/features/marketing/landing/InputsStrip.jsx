import { FileText, Image as ImageIcon, Sparkles } from "lucide-react";
import { Float } from "../../../motion/Float.jsx";
import { Reveal } from "../../../motion/Reveal.jsx";

const INPUTS = [
  {
    icon: Sparkles,
    badge: "Topic / Prompt",
    tone: "bg-accent-50 text-accent-800 border-accent-100",
    title: "Start from a question",
    text: "Type any concept up to 4,000 characters and choose automatic formatting or pin a diagram type.",
    delay: 0,
  },
  {
    icon: FileText,
    badge: "PDF Document",
    tone: "bg-spark-indigo-soft text-spark-indigo-ink border-spark-indigo-soft",
    title: "Extract selected PDF pages",
    text: "Upload digital or scanned lecture slides up to 20 MB, pick exact pages, and jump to citations.",
    delay: 900,
  },
  {
    icon: ImageIcon,
    badge: "Photo or Diagram",
    tone: "bg-spark-amber-soft text-spark-amber-ink border-spark-amber-soft",
    title: "Turn rough sketches clean",
    text: "Upload whiteboards or handwritten pages in JPEG, PNG, or WebP with EXIF metadata stripped automatically.",
    delay: 1800,
  },
];

/** Three input source cards with gentle compositor float animations. */
export function InputsStrip() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6" aria-labelledby="inputs-heading">
      <Reveal y={10}>
        <p className="text-xs font-semibold uppercase tracking-wider text-accent-700">Flexible inputs</p>
        <h2 id="inputs-heading" className="mt-1.5 font-display text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">
          Start from text, lecture slides, or a photo
        </h2>
      </Reveal>

      <div className="mt-8 grid gap-5 md:grid-cols-3">
        {INPUTS.map(({ icon: Icon, badge, tone, title, text, delay }, idx) => (
          <Reveal key={title} delay={idx * 70} y={14}>
            <Float delay={delay}>
              <article className="flex h-full flex-col rounded-2xl border border-stone-200 bg-surface p-6 shadow-xs transition-shadow hover:shadow-md">
                <div className="flex items-center justify-between gap-2">
                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    {badge}
                  </span>
                </div>
                <h3 className="mt-4 text-base font-semibold text-stone-900">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-stone-600">{text}</p>
              </article>
            </Float>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
