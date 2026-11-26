import { useState } from "react";
import { BookOpen, Eye, EyeOff, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "../../../components/Button.jsx";
import { Card } from "../../../components/Layout.jsx";
import { FormAlert } from "../../../components/Field.jsx";
import { useCreateRevision } from "../../../hooks/useNotes.js";
import { useUsage } from "../../../hooks/useProfile.js";
import { Collapse } from "../../../motion/Collapse.jsx";

export function RevisionSheetView({ noteId, revisionGuide }) {
  const createRevision = useCreateRevision();
  const { data: usage } = useUsage();
  const quotaReached = Boolean(usage && usage.remaining <= 0);
  const [revealed, setRevealed] = useState({});
  const [error, setError] = useState(null);

  function handleGenerate() {
    setError(null);
    createRevision.mutate(noteId, {
      onSuccess: () => setRevealed({}),
      onError: (err) => setError(err.message),
    });
  }

  return (
    <div className="space-y-5" data-testid="revision-view">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-stone-900">Revision sheet</h2>
            <p className="text-xs text-stone-600">A condensed cheat sheet with key terms, common pitfalls, and a self-check.</p>
          </div>
          <Button size="sm" onClick={handleGenerate} loading={createRevision.isPending} disabled={quotaReached} loadingText="Building sheet…" data-testid="generate-revision-btn">
            {revisionGuide ? <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> : <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
            {revisionGuide ? "Refresh sheet" : "Build revision sheet"}
          </Button>
        </div>
      </Card>

      <FormAlert>{error}</FormAlert>

      {!revisionGuide ? (
        <Card className="p-8 text-center">
          <BookOpen className="mx-auto h-8 w-8 text-accent-700" aria-hidden="true" />
          <p className="mt-2 text-sm font-medium text-stone-900">No revision sheet built for this version yet.</p>
          <p className="mt-1 text-xs text-stone-600">Compile key terms, common confusions, and self-check prompts into one view.</p>
        </Card>
      ) : (
        <div className="space-y-5">
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-stone-900">Summary</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-stone-700">{revisionGuide.summary}</p>
          </Card>

          <Card className="p-5">
            <h3 className="text-sm font-semibold text-stone-900">Key terms</h3>
            <dl className="mt-3 grid gap-3 sm:grid-cols-2">
              {(revisionGuide.keyTerms ?? []).map((item) => (
                <div key={item.term} className="rounded-lg border border-stone-200 bg-canvas/60 p-3">
                  <dt className="text-sm font-semibold text-stone-900">{item.term}</dt>
                  <dd className="mt-1 text-xs leading-relaxed text-stone-700">{item.definition}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card className="p-5">
            <h3 className="text-sm font-semibold text-stone-900">Common confusions</h3>
            <ul className="mt-3 space-y-2.5">
              {(revisionGuide.commonConfusions ?? []).map((c, idx) => (
                <li key={idx} className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-xs">
                  <p className="font-semibold text-amber-900">Pitfall: {c.misconception}</p>
                  <p className="mt-1 text-stone-800">Instead: {c.correction}</p>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="p-5">
            <h3 className="text-sm font-semibold text-stone-900">Self-check</h3>
            <ol className="mt-3 space-y-2.5">
              {(revisionGuide.selfCheck ?? []).map((item, idx) => {
                const open = Boolean(revealed[idx]);
                return (
                  <li key={idx} className="rounded-lg border border-stone-200 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-stone-900">
                        {idx + 1}. {item.question}
                      </p>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setRevealed((r) => ({ ...r, [idx]: !r[idx] }))}
                        aria-expanded={open}
                      >
                        {open ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
                        {open ? "Hide" : "Reveal"}
                      </Button>
                    </div>
                    <Collapse open={open}>
                      <p className="mt-2 border-t border-stone-200 pt-2 text-xs leading-relaxed text-stone-700">{item.answer}</p>
                    </Collapse>
                  </li>
                );
              })}
            </ol>
          </Card>
        </div>
      )}
    </div>
  );
}
