import { useState } from "react";
import { Crosshair, MessageSquare, Send } from "lucide-react";
import { Button } from "../../../components/Button.jsx";
import { Badge, Card } from "../../../components/Layout.jsx";
import { FormAlert, TextField } from "../../../components/Field.jsx";
import { useAskNote } from "../../../hooks/useNotes.js";

export function AskNoteView({ noteId, onFocusSection }) {
  const ask = useAskNote();
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState(null);

  function onSubmit(e) {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
    setError(null);
    ask.mutate(
      { id: noteId, question: q },
      {
        onSuccess: (res) => {
          setMessages((prev) => [...prev, { q, ...res }]);
          setQuestion("");
        },
        onError: (err) => setError(err.message),
      }
    );
  }

  return (
    <div className="space-y-5" data-testid="ask-note-view">
      <Card className="p-4 sm:p-5">
        <h2 className="text-base font-semibold text-stone-900">Ask this note</h2>
        <p className="text-xs text-stone-600">Questions are answered strictly from this note's diagrams, explanations, and cited sources.</p>

        <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <TextField
              label="Your question"
              placeholder="e.g. Why does the client wait before opening the stream?"
              maxLength={1000}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </div>
          <Button type="submit" loading={ask.isPending} loadingText="Thinking…" data-testid="ask-note-submit">
            <Send className="h-4 w-4" aria-hidden="true" />
            Ask
          </Button>
        </form>
      </Card>

      <FormAlert>{error}</FormAlert>

      {messages.length === 0 ? (
        <Card className="p-8 text-center">
          <MessageSquare className="mx-auto h-8 w-8 text-accent-700" aria-hidden="true" />
          <p className="mt-2 text-sm font-medium text-stone-900">Ask anything covered in this note.</p>
          <p className="mt-1 text-xs text-stone-600">If an answer isn't in your saved material, Visualify will tell you rather than guessing.</p>
        </Card>
      ) : (
        <ul className="space-y-3" aria-label="Study Q&A history">
          {messages.map((m, idx) => (
            <li key={idx}>
              <Card className="space-y-3 p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-stone-900">{m.q}</p>
                  <Badge tone={m.grounded ? "accent" : "soon"}>
                    {m.grounded ? "Grounded in note" : "Not in note"}
                  </Badge>
                </div>
                <p className="whitespace-pre-line text-sm leading-relaxed text-stone-700">{m.answer}</p>
                {m.citations?.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 border-t border-stone-200 pt-2.5">
                    <span className="text-xs text-stone-500">Citations:</span>
                    {m.citations.map((c, cIdx) =>
                      c.sectionId && onFocusSection ? (
                        <button
                          key={cIdx}
                          type="button"
                          onClick={() => onFocusSection(c.sectionId)}
                          className="inline-flex items-center gap-1 rounded-full border border-accent-700/30 bg-accent-50 px-2.5 py-0.5 text-xs font-medium text-accent-900 hover:bg-accent-100"
                        >
                          <Crosshair className="h-3 w-3" aria-hidden="true" />
                          {c.label}
                        </button>
                      ) : (
                        <Badge key={cIdx}>{c.label}</Badge>
                      )
                    )}
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
