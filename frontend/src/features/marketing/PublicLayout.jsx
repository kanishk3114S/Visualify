import { Link, NavLink, Outlet } from "react-router-dom";
import clsx from "clsx";
import { Logo } from "../../components/Layout.jsx";
import { BrandMark } from "../../brand/BrandMark.jsx";
import { ButtonLink } from "../../components/Button.jsx";
import { ThemeToggle } from "../../components/ThemeToggle.jsx";
import { useAuth } from "../auth/AuthContext.jsx";

/** Header/footer for public marketing and legal pages. */
export function PublicLayout() {
  const { status } = useAuth();
  const signedIn = status === "authenticated";
  const navClass = ({ isActive }) =>
    clsx(
      "rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
      isActive ? "bg-accent-50 text-accent-900" : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
    );

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-stone-200/80 bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-6">
            <Logo />
            <nav aria-label="Primary" className="hidden sm:block">
              <NavLink to="/features" viewTransition className={navClass}>
                Features
              </NavLink>
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle compact />
            {signedIn ? (
              <ButtonLink to="/app" size="sm">
                Open dashboard
              </ButtonLink>
            ) : (
              <>
                <ButtonLink to="/login" variant="ghost" size="sm">
                  Sign in
                </ButtonLink>
                <ButtonLink to="/signup" size="sm">
                  Get started
                </ButtonLink>
              </>
            )}
          </div>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-none">
        <Outlet />
      </main>
      <footer className="border-t border-stone-200 bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-stone-600 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2.5">
            <BrandMark size={20} variant="mono" decorative className="text-stone-500" />
            <p>© {new Date().getFullYear()} Visualify — Editable visual study notes.</p>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-5">
            <Link to="/features" viewTransition className="hover:text-stone-900 sm:hidden">
              Features
            </Link>
            <Link to="/features" viewTransition className="hidden hover:text-stone-900 sm:inline">
              Features
            </Link>
            <Link to="/privacy" viewTransition className="hover:text-stone-900">
              Privacy
            </Link>
            <Link to="/terms" viewTransition className="hover:text-stone-900">
              Terms
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
