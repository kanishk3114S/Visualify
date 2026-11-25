import { Link } from "react-router-dom";
import { Logo } from "../../components/Layout.jsx";
import { ThemeToggle } from "../../components/ThemeToggle.jsx";

/** Centered card layout shared by every authentication screen. */
export function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-4 py-5 sm:px-8">
        <Logo />
        <ThemeToggle compact />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-4 sm:pt-10">
        <div className="w-full max-w-md">
          <div className="rounded-xl border border-stone-200 bg-surface p-6 shadow-xs sm:p-8">
            <div className="mb-6 space-y-1.5">
              <h1 className="text-xl font-semibold tracking-tight text-stone-900">{title}</h1>
              {subtitle && <p className="text-sm text-stone-600">{subtitle}</p>}
            </div>
            {children}
          </div>
          {footer && <div className="mt-5 text-center text-sm text-stone-600">{footer}</div>}
        </div>
      </main>
      <footer className="flex justify-center gap-4 px-4 py-6 text-xs text-stone-500">
        <Link to="/privacy" className="hover:text-stone-800 hover:underline">
          Privacy
        </Link>
        <Link to="/terms" className="hover:text-stone-800 hover:underline">
          Terms
        </Link>
      </footer>
    </div>
  );
}

/** "or" divider between OAuth and email forms. */
export function Divider({ label = "or" }) {
  return (
    <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wide text-stone-500" role="separator">
      <span className="h-px flex-1 bg-stone-200" />
      {label}
      <span className="h-px flex-1 bg-stone-200" />
    </div>
  );
}

export const textLink = "font-medium text-accent-700 underline-offset-2 hover:text-accent-800 hover:underline";
