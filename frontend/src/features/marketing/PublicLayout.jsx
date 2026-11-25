import { Link, NavLink, Outlet } from "react-router-dom";
import clsx from "clsx";
import { Logo } from "../../components/Layout.jsx";
import { ButtonLink } from "../../components/Button.jsx";
import { ThemeToggle } from "../../components/ThemeToggle.jsx";
import { useAuth } from "../auth/AuthContext.jsx";

/** Header/footer for public marketing and legal pages. */
export function PublicLayout() {
  const { status } = useAuth();
  const signedIn = status === "authenticated";
  const navClass = ({ isActive }) =>
    clsx("rounded-md px-2 py-1 text-sm font-medium", isActive ? "text-stone-900" : "text-stone-600 hover:text-stone-900");

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-stone-200/80 bg-canvas/90">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-6">
            <Logo />
            <nav aria-label="Primary" className="hidden sm:block">
              <NavLink to="/features" className={navClass}>
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
      <main id="main-content" className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-stone-200 bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-stone-600 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>© {new Date().getFullYear()} Visualify</p>
          <nav aria-label="Footer" className="flex gap-5">
            <Link to="/features" className="hover:text-stone-900 sm:hidden">
              Features
            </Link>
            <Link to="/privacy" className="hover:text-stone-900">
              Privacy
            </Link>
            <Link to="/terms" className="hover:text-stone-900">
              Terms
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
