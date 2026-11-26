import { useEffect, useState } from "react";
import clsx from "clsx";
import { CheckCircle2, HelpCircle, RotateCcw, Sparkles, XCircle } from "lucide-react";
import { Button } from "../../../components/Button.jsx";
import { Badge, Card } from "../../../components/Layout.jsx";
import { FormAlert } from "../../../components/Field.jsx";
import { SegmentedControl } from "../../../components/SegmentedControl.jsx";
import { useCreateQuiz, useSubmitQuiz } from "../../../hooks/useNotes.js";
import { useUsage } from "../../../hooks/useProfile.js";
import { SourceRefChips } from "../../generation/VisualWorkspace.jsx";

export function QuizView({ noteId, quiz, onFocusSection }) {
  const createQuiz = useCreateQuiz();
  const submitQuiz = useSubmitQuiz();
  const { data: usage } = useUsage();
  const quotaReached = Boolean(usage && usage.remaining <= 0);
  const [difficulty, setDifficulty] = useState(quiz?.difficulty ?? "mixed");
  const [answers, setAnswers] = useState(() => quiz?.answers ?? {});
  const [error, setError] = useState(null);

  useEffect(() => {
    setAnswers(quiz?.answers ?? {});
    if (quiz?.difficulty) setDifficulty(quiz.difficulty);
  }, [quiz?.id, quiz?.updatedAt]);

  function handleGenerate() {
    setError(null);
    createQuiz.mutate(
      { id: noteId, difficulty, questionCount: 5 },
      {
        onSuccess: (next) => setAnswers(next?.answers ?? {}),
        onError: (err) => setError(err.message),
      }
    );
  }

  function pickOption(questionId, optionIndex) {
    if (!quiz) return;
    const nextAnswers = { ...answers, [questionId]: optionIndex };
    setAnswers(nextAnswers);
    setError(null);
    submitQuiz.mutate(
      { id: noteId, quizId: quiz.id, answers: nextAnswers },
      { onError: (err) => setError(err.message) }
    );
  }

  const questions = quiz?.questions ?? [];
  const answeredCount = questions.filter((q) => Number.isInteger(answers[q.id])).length;
  const computedScore = questions.reduce((acc, q) => (answers[q.id] === q.correctIndex ? acc + 1 : acc), 0);

  return (
    <div className="space-y-5" data-testid="quiz-view">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-stone-900">Quick quiz</h2>
            <p className="text-xs text-stone-600">Test your understanding directly from this note's diagrams and explanations.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl
              label="Quiz difficulty"
              size="sm"
              value={difficulty}
              onChange={setDifficulty}
              options={[
                { value: "foundational", label: "Foundational" },
                { value: "mixed", label: "Mixed" },
                { value: "challenging", label: "Challenging" },
              ]}
            />
            <Button size="sm" onClick={handleGenerate} loading={createQuiz.isPending} disabled={quotaReached} loadingText="Creating quiz…" data-testid="generate-quiz-btn">
              {quiz ? <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> : <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
              {quiz ? "New quiz" : "Generate quiz"}
            </Button>
          </div>
        </div>

        {quiz && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-stone-200 pt-3 text-xs">
            <Badge tone="accent" data-testid="quiz-score-badge">
              Score: {quiz.score ?? computedScore} / {quiz.totalQuestions}
            </Badge>
            <span className="text-stone-600">
              {answeredCount} of {quiz.totalQuestions} answered
            </span>
          </div>
        )}
      </Card>

      <FormAlert>{error}</FormAlert>
      {quotaReached && <FormAlert>Monthly AI quota reached ({usage.used} / {usage.limit}).</FormAlert>}

      {!quiz ? (
        <Card className="p-8 text-center">
          <HelpCircle className="mx-auto h-8 w-8 text-accent-700" aria-hidden="true" />
          <p className="mt-2 text-sm font-medium text-stone-900">No quiz generated for this version yet.</p>
          <p className="mt-1 text-xs text-stone-600">Pick a difficulty above and generate a 5-question multiple-choice check.</p>
        </Card>
      ) : (
        <ol className="space-y-4">
          {questions.map((q, idx) => {
            const picked = answers[q.id];
            const hasPicked = Number.isInteger(picked);
            const isCorrect = picked === q.correctIndex;
            return (
              <li key={q.id}>
                <Card className="p-4 sm:p-5" data-testid={`quiz-question-${idx}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold text-stone-900">
                      {idx + 1}. {q.question}
                    </h3>
                    {q.concept && <Badge>{q.concept}</Badge>}
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={`Question ${idx + 1} choices`}>
                    {q.options.map((opt, optIdx) => {
                      const selected = picked === optIdx;
                      const showRight = hasPicked && optIdx === q.correctIndex;
                      const showWrong = selected && optIdx !== q.correctIndex;
                      return (
                        <button
                          key={`${q.id}-${optIdx}`}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => pickOption(q.id, optIdx)}
                          className={clsx(
                            "flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors active:scale-[0.99]",
                            showRight
                              ? "border-accent-700 bg-accent-50 text-accent-900"
                              : showWrong
                                ? "border-red-600 bg-red-50 text-red-900"
                                : selected
                                  ? "border-accent-700 bg-accent-50 text-stone-900"
                                  : "border-stone-200 bg-surface text-stone-800 hover:border-stone-400"
                          )}
                        >
                          <span>{opt}</span>
                          {showRight && <CheckCircle2 className="h-4 w-4 shrink-0 text-accent-700" aria-hidden="true" />}
                          {showWrong && <XCircle className="h-4 w-4 shrink-0 text-red-700" aria-hidden="true" />}
                        </button>
                      );
                    })}
                  </div>
                  {hasPicked && (
                    <div className="mt-3 rounded-lg border border-stone-200 bg-canvas px-3 py-2 text-xs text-stone-700">
                      <span className={clsx("font-semibold", isCorrect ? "text-accent-800" : "text-red-700")}>
                        {isCorrect ? "Correct:" : "Not quite:"}
                      </span>{" "}
                      {q.explanation}
                      {q.sectionId && onFocusSection && (
                        <button
                          type="button"
                          onClick={() => onFocusSection(q.sectionId)}
                          className="ml-2 font-medium text-accent-700 underline hover:text-accent-800"
                        >
                          View section
                        </button>
                      )}
                    </div>
                  )}
                  <SourceRefChips refs={q.sourceRefs} />
                </Card>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
