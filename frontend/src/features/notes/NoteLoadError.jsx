import { AlertTriangle } from "lucide-react";
import { Button, ButtonLink } from "../../components/Button.jsx";
import { Card } from "../../components/Layout.jsx";

/** Consistent not-found / failed-load state (never reveals whether another user owns the id). */
export function NoteLoadError({ error, onRetry }) {
  const notFound = error?.status === 404;
  return (
    <div className="px-4 py-10 sm:px-6">
      <Card className="mx-auto max-w-xl p-6 sm:p-8" role="alert" data-testid="note-load-error">
        <AlertTriangle className="h-8 w-8 text-red-700" aria-hidden="true" />
        <h1 className="mt-3 text-xl font-semibold tracking-tight text-stone-900">{notFound ? "Note not found" : "We couldn't load this note"}</h1>
        <p className="mt-2 text-sm text-stone-700">{notFound ? "It may have been deleted, or the link is incorrect." : error?.message}</p>
        {error?.requestId && <p className="mt-1 text-xs text-stone-500">Reference: {error.requestId}</p>}
        <div className="mt-6 flex flex-wrap gap-3">
          {!notFound && (
            <Button variant="secondary" onClick={() => onRetry?.()}>
              Try again
            </Button>
          )}
          <ButtonLink to="/app/notes">Go to library</ButtonLink>
        </div>
      </Card>
    </div>
  );
}
