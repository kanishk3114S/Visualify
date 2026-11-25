import { Button } from "../../components/Button.jsx";

/** Shared error state when GET /api/v1/me fails. */
export function ProfileLoadError({ onRetry, error }) {
  return (
    <div role="alert" className="mb-6 flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 p-4 sm:flex-row sm:items-center" data-testid="profile-error">
      <p className="flex-1 text-sm text-red-800">
        {error?.message ?? "We couldn't load your profile."}{" "}
        {error?.requestId && <span className="text-red-700/80">(Reference: {error.requestId})</span>}
      </p>
      <Button variant="secondary" size="sm" onClick={() => onRetry()}>
        Try again
      </Button>
    </div>
  );
}
