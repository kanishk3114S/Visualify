import { isRouteErrorResponse, useRouteError } from "react-router-dom";
import { ButtonLink } from "../components/Button.jsx";

/** Last-resort screen for render errors or failed lazy chunks. Never shows stack traces. */
export function RouteErrorBoundary() {
  const error = useRouteError();
  if (import.meta.env.DEV) console.error(error);
  const chunkFailed = error instanceof TypeError && /dynamically imported module|Importing a module script/i.test(error.message);
  const title = isRouteErrorResponse(error) && error.status === 404 ? "Page not found" : "Something went wrong";
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center px-4 text-center" role="alert">
      <h1 className="text-2xl font-semibold tracking-tight text-stone-900">{title}</h1>
      <p className="mt-3 text-stone-600">
        {chunkFailed
          ? "Part of the app failed to load, possibly because a new version was released. Reload the page to continue."
          : "An unexpected error occurred. Please reload the page or go back home."}
      </p>
      <div className="mt-8 flex gap-3">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="h-10 rounded-md bg-accent-700 px-4 text-sm font-medium text-on-accent hover:bg-accent-800"
        >
          Reload
        </button>
        <ButtonLink to="/" variant="secondary">
          Home
        </ButtonLink>
      </div>
    </div>
  );
}
