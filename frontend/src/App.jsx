import { RouterProvider } from "react-router-dom";
import { AppProviders } from "./app/providers.jsx";
import { router } from "./app/router.jsx";
import { envProblems } from "./lib/env.js";

/** Shown instead of the app when required public config is missing (names only, never values). */
function ConfigErrorScreen() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-4">
      <h1 className="text-xl font-semibold text-stone-900">Visualify isn't configured</h1>
      <p className="mt-3 text-sm text-stone-600">
        Set these variables in <code className="rounded bg-stone-100 px-1">frontend/.env.local</code> (see{" "}
        <code className="rounded bg-stone-100 px-1">frontend/.env.example</code>) and restart the dev server:
      </p>
      <ul className="mt-3 list-disc pl-5 text-sm text-stone-800">
        {envProblems.map((name) => (
          <li key={name}>
            <code>{name}</code>
          </li>
        ))}
      </ul>
    </main>
  );
}

export default function App() {
  if (envProblems.length > 0) return <ConfigErrorScreen />;
  return (
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
