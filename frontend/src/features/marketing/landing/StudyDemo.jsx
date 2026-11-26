import { useState } from "react";
import clsx from "clsx";
import { CheckCircle2, HelpCircle, Layers, RotateCw } from "lucide-react";
import { Badge } from "../../../components/Layout.jsx";
import { Reveal } from "../../../motion/Reveal.jsx";
import { useReducedMotion } from "../../../motion/useReducedMotion.js";

const QUIZ_OPTIONS = [
  { id: "a", text: "Client immediately starts sending application data without a reply" },
  { id: "b", text: "Server echoes seq = x + 1 and proposes its own initial sequence y", correct: true },
  { id: "c", text: "Router tears down the socket after two round trips" },
];

/** Static interactive preview of Visualify's Study Kit (Flashcard flip + Quiz check). */
export function StudyDemo() {
  const reducedMotion = useReducedMotion();
  const [flipped, setFlipped] = useState(false);
  const [picked, setPicked] = useState(null);

  const pickedOpt = QUIZ_OPTIONS.find((o) => o.id === picked);

  return (
    <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6" aria-labelledby="study-demo-heading">
      <Reveal y={10}>
        <div className="flex flex-wrap items-center gap-2.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-spark-indigo">Active recall companion</p>
          <Badge tone="neutral">Example preview</Badge>
        </div>
        <h2 id="study-demo-heading" className="mt-1.5 font-display text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">
          Every visual note ships with quizzes &amp; flashcards
        </h2>
      </Reveal>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <Reveal delay={40} y={12}>
          <div className="flex h-full flex-col rounded-2xl border border-stone-200 bg-surface p-6 shadow-xs">
            <div className="mb-4 flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-700">
                <Layers className="h-4 w-4 text-accent-700" aria-hidden="true" />
                Sample Flashcard
              </span>
              <span className="text-xs text-stone-500">Tap to flip</span>
            </div>

            <button
              type="button"
              data-testid="demo-flashcard"
              onClick={() => setFlipped((f) => !f)}
              aria-pressed={flipped}
              className={clsx(
                "flex min-h-[12rem] w-full flex-1 flex-col items-center justify-center rounded-xl border-2 p-5 text-center transition-[background-color,border-color,transform] duration-200 active:scale-[0.99]",
                !reducedMotion && "hover:-translate-y-0.5",
                flipped ? "border-accent-700 bg-accent-50/70" : "border-stone-200 bg-canvas/70 hover:border-stone-300"
              )}
            >
              <Badge tone={flipped ? "accent" : "neutral"}>{flipped ? "Answer" : "Prompt"}</Badge>
              <p className="mt-3 max-w-sm text-sm font-semibold leading-relaxed text-stone-900">
                {flipped
                  ? "The server sends SYN-ACK with ack = x + 1 and its own random initial sequence number y."
                  : "During the TCP handshake, what does the server put inside the second packet (SYN-ACK)?"}
              </p>
              <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-accent-700">
                <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
                {flipped ? "Show prompt" : "Reveal answer"}
              </span>
            </button>
          </div>
        </Reveal>

        <Reveal delay={110} y={12}>
          <div className="flex h-full flex-col rounded-2xl border border-stone-200 bg-surface p-6 shadow-xs">
            <div className="mb-4 flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-700">
                <HelpCircle className="h-4 w-4 text-spark-indigo" aria-hidden="true" />
                Sample Concept Check
              </span>
              <span className="text-xs text-stone-500">Pick an option</span>
            </div>

            <p className="text-sm font-semibold text-stone-900">Why must both endpoints acknowledge sequence numbers before HTTP data starts?</p>
            <div className="mt-3 space-y-2">
              {QUIZ_OPTIONS.map((opt) => {
                const chosen = picked === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    aria-pressed={chosen}
                    onClick={() => setPicked(opt.id)}
                    className={clsx(
                      "flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-xs font-medium transition-colors active:scale-[0.99]",
                      chosen
                        ? opt.correct
                          ? "border-accent-700 bg-accent-50 text-accent-900"
                          : "border-red-300 bg-red-50 text-red-900"
                        : "border-stone-200 bg-canvas/60 text-stone-800 hover:border-stone-300"
                    )}
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-current text-[11px] font-bold uppercase">
                      {opt.id}
                    </span>
                    <span className="flex-1">{opt.text}</span>
                    {chosen && opt.correct && <CheckCircle2 className="h-4 w-4 shrink-0 text-accent-700" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>

            <div role="status" aria-live="polite" className="mt-3 min-h-[2.25rem] text-xs leading-relaxed text-stone-600">
              {pickedOpt ? (
                pickedOpt.correct ? (
                  <span className="font-medium text-accent-800">
                    Correct — verifying both sequence numbers prevents stale packets from corrupting a fresh stream.
                  </span>
                ) : (
                  <span className="font-medium text-red-700">
                    Not quite — look at step 2 where the server confirms seq = x + 1 and proposes y.
                  </span>
                )
              ) : (
                <span>Paired inside each note alongside Quiz mode, Revision sheets, and Ask your note.</span>
              )}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
