import { useEffect, useState } from "react";
import clsx from "clsx";
import { Check, ChevronLeft, ChevronRight, Layers, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "../../../components/Button.jsx";
import { Badge, Card } from "../../../components/Layout.jsx";
import { FormAlert } from "../../../components/Field.jsx";
import { SegmentedControl } from "../../../components/SegmentedControl.jsx";
import { useCreateFlashcards, useUpdateFlashcard } from "../../../hooks/useNotes.js";
import { useUsage } from "../../../hooks/useProfile.js";
import { summarizeFlashcards } from "../../../lib/frames.js";

export function FlashcardsView({ noteId, flashcards = [] }) {
  const createCards = useCreateFlashcards();
  const updateCard = useUpdateFlashcard();
  const { data: usage } = useUsage();
  const quotaReached = Boolean(usage && usage.remaining <= 0);
  const [filter, setFilter] = useState("all");
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [error, setError] = useState(null);

  const visible = flashcards.filter((c) => {
    if (filter === "review") return c.mastery !== "known";
    if (filter === "known") return c.mastery === "known";
    return true;
  });

  useEffect(() => {
    setIndex(0);
    setFlipped(false);
  }, [filter, flashcards.length]);

  const current = visible[index] ?? null;
  const stats = summarizeFlashcards(flashcards);

  function handleGenerate() {
    setError(null);
    createCards.mutate(
      { id: noteId, cardCount: 8 },
      {
        onSuccess: () => {
          setIndex(0);
          setFlipped(false);
        },
        onError: (err) => setError(err.message),
      }
    );
  }

  function markMastery(mastery) {
    if (!current) return;
    setError(null);
    updateCard.mutate(
      { id: noteId, cardId: current.id, mastery },
      {
        onSuccess: () => {
          setFlipped(false);
          if (visible.length > 1) setIndex((i) => (i + 1) % visible.length);
        },
        onError: (err) => setError(err.message),
      }
    );
  }

  return (
    <div className="space-y-5" data-testid="flashcards-view">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-stone-900">Flashcards</h2>
            <p className="text-xs text-stone-600">Click or press Space to flip a card, then mark whether you know it or want another review.</p>
          </div>
          <Button size="sm" onClick={handleGenerate} loading={createCards.isPending} disabled={quotaReached} loadingText="Creating cards…" data-testid="generate-flashcards-btn">
            {flashcards.length ? <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> : <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
            {flashcards.length ? "Regenerate deck" : "Generate flashcards"}
          </Button>
        </div>

        {flashcards.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 pt-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge tone="accent" data-testid="flashcards-known-badge">
                {stats.known} / {stats.total} known
              </Badge>
              <span className="text-stone-600">{stats.review} marked for review</span>
            </div>
            <SegmentedControl
              label="Filter flashcards"
              size="sm"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: `All (${stats.total})` },
                { value: "review", label: `Review (${stats.total - stats.known})` },
                { value: "known", label: `Known (${stats.known})` },
              ]}
            />
          </div>
        )}
      </Card>

      <FormAlert>{error}</FormAlert>

      {flashcards.length === 0 ? (
        <Card className="p-8 text-center">
          <Layers className="mx-auto h-8 w-8 text-accent-700" aria-hidden="true" />
          <p className="mt-2 text-sm font-medium text-stone-900">No flashcards for this version yet.</p>
          <p className="mt-1 text-xs text-stone-600">Generate a deck of concept &amp; relationship cards to practice active recall.</p>
        </Card>
      ) : !current ? (
        <Card className="p-6 text-center text-sm text-stone-700">No cards match this filter.</Card>
      ) : (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setFlipped((f) => !f)}
            aria-pressed={flipped}
            data-testid="flashcard-card"
            className={clsx(
              "flex min-h-[14rem] w-full flex-col items-center justify-center rounded-2xl border-2 p-6 text-center shadow-xs transition-all duration-150 active:scale-[0.99]",
              flipped ? "border-accent-700 bg-accent-50/60" : "border-stone-200 bg-surface hover:border-stone-300"
            )}
          >
            <div className="mb-3 flex items-center gap-2">
              <Badge tone={flipped ? "accent" : "neutral"}>{flipped ? "Answer" : "Prompt"}</Badge>
              {current.concept && <Badge>{current.concept}</Badge>}
              {current.mastery === "known" && <Badge tone="accent">Known</Badge>}
            </div>
            <p className="max-w-xl text-base font-medium leading-relaxed text-stone-900">
              {flipped ? current.back : current.front}
            </p>
            {!flipped && current.hint && (
              <p className="mt-3 text-xs text-stone-500">Hint: {current.hint}</p>
            )}
            <span className="mt-4 text-xs text-stone-500">Click or press Enter/Space to {flipped ? "see prompt" : "reveal answer"}</span>
          </button>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={visible.length <= 1}
                onClick={() => {
                  setFlipped(false);
                  setIndex((i) => (i - 1 + visible.length) % visible.length);
                }}
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                Prev
              </Button>
              <span className="text-xs tabular-nums text-stone-600">
                Card {index + 1} of {visible.length}
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={visible.length <= 1}
                onClick={() => {
                  setFlipped(false);
                  setIndex((i) => (i + 1) % visible.length);
                }}
              >
                Next
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={updateCard.isPending}
                onClick={() => markMastery("review")}
                data-testid="flashcard-review-btn"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Review again
              </Button>
              <Button
                size="sm"
                disabled={updateCard.isPending}
                onClick={() => markMastery("known")}
                data-testid="flashcard-known-btn"
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                Know it
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
