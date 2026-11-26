import { useState } from "react";
import { Crosshair, MessageSquare, Send, Sparkles } from "lucide-react";
import { Button } from "../../../components/Button.jsx";
import { Badge } from "../../../components/Layout.jsx";
import { FormAlert, TextField } from "../../../components/Field.jsx";
import { useAskNote, useExplainSelection } from "../../../hooks/useNotes.js";
import { useUsage } from "../../../hooks/useProfile.js";
import { buildSelectedContext } from "../../../lib/frames.js";

const QUICK_PROMPTS = [
  { label: "Explain simply", q: "Explain this clearly in simple terms." },
  { label: "Give analogy", q: "Explain this using a concrete everyday analogy." },
  { label: "Why this step?", q: "Why does this element or step happen here?" },
];

export function StudyAssistantPanel({
  noteId,
  selectedElements = [],
  allElements = [],
  lastExplain = null,
  onExplainResult,
  onFocusSection,
}) {
  const explain = useExplainSelection();
  const ask = useAskNote();
  const { data: usage } = useUsage();
  const quotaReached = Boolean(usage && usage.remaining <= 0);
  const [explainQuestion, setExplainQuestion] = useState("");
  const [askQuestion, setAskQuestion] = useState("");
  const [askResult, setAskResult] = useState(null);
  const [error, setError] = useState(null);

  const selectionContext = buildSelectedContext(selectedElements, allElements);

  function runExplain(customQuestion = explainQuestion) {
    if (selectionContext.length === 0) return;
    setError(null);
    explain.mutate(
      {
        id: noteId,
        selectedElements: selectionContext,
        question: customQuestion.trim() || undefined,
      },
      {
        onSuccess: (res) => onExplainResult?.(res),
        onError: (err) => setError(err.message),
      }
    );
  }

  function runAsk(e) {
    e.preventDefault();
    const q = askQuestion.trim();
    if (!q) return;
    setError(null);
    ask.mutate(
      { id: noteId, question: q },
      {
        onSuccess: (res) => setAskResult({ q, ...res }),
        onError: (err) => setError(err.message),
      }
    );
  }

  return (
    <div className="space-y-6" data-testid="study-assistant-panel">
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-stone-900">
            <Sparkles className="h-4 w-4 text-accent-700" aria-hidden="true" />
            Explain selection
          </h3>
          <Badge tone={selectionContext.length ? "accent" : "neutral"}>
            {selectionContext.length ? `${selectionContext.length} selected` : "Nothing selected"}
          </Badge>
        </div>

        {selectionContext.length === 0 ? (
          <p className="rounded-lg border border-stone-200 bg-canvas p-3 text-xs text-stone-600">
            Click any box, arrow, or label on the canvas to ask for a simpler breakdown or analogy.
          </p>
        ) : (
          <div className="space-y-2.5 rounded-lg border border-stone-200 bg-canvas p-3">
            <ul className="flex flex-wrap gap-1.5">
              {QUICK_PROMPTS.map((p) => (
                <li key={p.label}>
                  <button
                    type="button"
                    disabled={explain.isPending || quotaReached}
                    onClick={() => runExplain(p.q)}
                    className="rounded-full border border-stone-300 bg-surface px-2.5 py-1 text-xs font-medium text-stone-800 hover:border-accent-700 hover:text-accent-900"
                  >
                    {p.label}
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <div className="flex-1">
                <TextField
                  label="Custom follow-up"
                  placeholder="Optional question about selection"
                  value={explainQuestion}
                  onChange={(e) => setExplainQuestion(e.target.value)}
                />
              </div>
                <Button
                size="sm"
                className="self-end"
                loading={explain.isPending}
                disabled={quotaReached}
                loadingText="…"
                onClick={() => runExplain()}
                data-testid="assistant-explain-submit"
              >
                Explain
              </Button>
            </div>
          </div>
        )}

        <FormAlert>{error}</FormAlert>

        {lastExplain && (
          <div className="space-y-2 rounded-lg border border-accent-700/30 bg-accent-50/40 p-3 text-xs text-stone-800" data-testid="explain-selection-result">
            <p className="font-semibold text-stone-900">{lastExplain.keyPoint}</p>
            <p className="leading-relaxed">{lastExplain.explanation}</p>
            {lastExplain.analogy && (
              <p className="italic text-stone-700">Analogy: {lastExplain.analogy}</p>
            )}
            {lastExplain.relatedConcepts?.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {lastExplain.relatedConcepts.map((c) => (
                  <Badge key={c}>{c}</Badge>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="space-y-3 border-t border-stone-200 pt-5">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-stone-900">
          <MessageSquare className="h-4 w-4 text-accent-700" aria-hidden="true" />
          Ask this note
        </h3>
        <form onSubmit={runAsk} className="space-y-2">
          <TextField
            label="Question"
            placeholder="Ask something about this note…"
            value={askQuestion}
            onChange={(e) => setAskQuestion(e.target.value)}
          />
          <Button type="submit" size="sm" variant="secondary" loading={ask.isPending} loadingText="Thinking…" data-testid="assistant-ask-submit">
            <Send className="h-3.5 w-3.5" aria-hidden="true" />
            Ask note
          </Button>
        </form>
        {askResult && (
          <div className="space-y-2 rounded-lg border border-stone-200 bg-canvas p-3 text-xs text-stone-800" data-testid="assistant-ask-result">
            <Badge tone={askResult.grounded ? "accent" : "soon"}>
              {askResult.grounded ? "Grounded in note" : "Not in note"}
            </Badge>
            <p className="leading-relaxed">{askResult.answer}</p>
            {askResult.citations?.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {askResult.citations.map((c, idx) =>
                  c.sectionId && onFocusSection ? (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => onFocusSection(c.sectionId)}
                      className="inline-flex items-center gap-1 rounded-full border border-accent-700/30 bg-accent-50 px-2 py-0.5 text-[11px] font-medium text-accent-900"
                    >
                      <Crosshair className="h-3 w-3" aria-hidden="true" />
                      {c.label}
                    </button>
                  ) : (
                    <Badge key={idx}>{c.label}</Badge>
                  )
                )}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
