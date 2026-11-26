import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useMatches, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { FolderOpen, LayoutDashboard, LogOut, Menu, Settings, Sparkles, User, X } from "lucide-react";
import { Logo } from "../components/Layout.jsx";
import { Avatar } from "../components/Avatar.jsx";
import { useAuth } from "../features/auth/AuthContext.jsx";
import { useProfile } from "../hooks/useProfile.js";
import { useToast } from "../components/Toast.jsx";
import { ThemeToggle } from "../components/ThemeToggle.jsx";

const NAV = [
  { to: "/app", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/app/create", label: "Create", icon: Sparkles },
  { to: "/app/notes", label: "My Notes", icon: FolderOpen },
  { to: "/app/profile", label: "Profile", icon: User },
  { to: "/app/settings", label: "Settings", icon: Settings },
];

/** rail: on large screens show icons only (labels stay available to assistive tech and as tooltips). */
function NavItems({ onNavigate, rail = false }) {
  const label = rail ? "lg:sr-only" : undefined;
  return (
    <ul className="space-y-1">
      {NAV.map((item) => {
        const Icon = item.icon;
        if (item.soon) {
          // Release policy: unreleased features are labelled, never dead links.
          return (
            <li key={item.label}>
              <span
                className={clsx("flex items-center gap-3 rounded-md px-3 py-2 text-sm text-stone-500", rail && "lg:justify-center lg:px-0")}
                aria-label={`${item.label} (coming later)`}
                title={rail ? `${item.label} (coming later)` : undefined}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span className={clsx("flex-1", label)}>{item.label}</span>
                <span className={clsx("rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-600", rail && "lg:hidden")} aria-hidden="true">
                  Soon
                </span>
              </span>
            </li>
          );
        }
        return (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.end}
              onClick={onNavigate}
              title={rail ? item.label : undefined}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  rail && "lg:justify-center lg:px-0",
                  isActive ? "bg-accent-50 text-accent-900" : "text-stone-700 hover:bg-stone-100 hover:text-stone-900"
                )
              }
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              <span className={label}>{item.label}</span>
            </NavLink>
          </li>
        );
      })}
    </ul>
  );
}

function UserFooter({ rail = false }) {
  const { user, signOut } = useAuth();
  const { data: profile } = useProfile();
  const toast = useToast();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);

  async function handleSignOut() {
    setPending(true);
    try {
      await signOut();
      toast.info("You've been signed out.");
      navigate("/login", { replace: true });
    } catch {
      toast.error("We couldn't sign you out. Please try again.");
      setPending(false);
    }
  }

  const name = profile?.display_name || user?.email || "";
  return (
    <div className={clsx("flex items-center gap-3 border-t border-stone-200 p-3", rail && "lg:flex-col lg:gap-2 lg:px-2")}>
      <Avatar src={profile?.avatar_url} name={profile?.display_name} fallbackText={user?.email} size="md" />
      <div className={clsx("min-w-0 flex-1", rail && "lg:hidden")}>
        <p className="truncate text-sm font-medium text-stone-900" data-testid="shell-user-name">
          {name}
        </p>
        {profile?.username && <p className="truncate text-xs text-stone-500">@{profile.username}</p>}
      </div>
      <ThemeToggle compact align="up" />
      <button
        type="button"
        onClick={handleSignOut}
        disabled={pending}
        className="rounded-md p-2 text-stone-600 hover:bg-stone-100 hover:text-stone-900 disabled:opacity-50"
        aria-label="Sign out"
        title="Sign out"
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

/** Persistent app layout for every /app/* page (PRD 7.1). */
export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const matches = useMatches();
  const fullWidth = matches.some((m) => m.handle?.fullWidth);
  const wide = matches.some((m) => m.handle?.wide);

  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => {
    if (!mobileOpen) return undefined;
    const onKey = (e) => e.key === "Escape" && setMobileOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  return (
    <div className="min-h-dvh lg:flex" data-testid="app-shell">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow"
      >
        Skip to content
      </a>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-stone-200 bg-surface/95 px-4 lg:hidden">
        <Logo to="/app" />
          <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          aria-expanded={mobileOpen}
          aria-controls="app-nav"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md p-2 text-stone-700 hover:bg-stone-100"
          aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
        >
          {mobileOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
        </button>
      </header>

      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" aria-hidden="true" onClick={() => setMobileOpen(false)} />
      )}

      <nav
        id="app-nav"
        aria-label="Main"
        className={clsx(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-stone-200 bg-surface transition-transform lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0",
          // The workspace needs the width: collapse to an icon rail on large screens.
          fullWidth && "lg:w-16",
          // Closed mobile drawer is also `invisible`, so it can't take keyboard focus off-screen.
          mobileOpen ? "visible translate-x-0" : "invisible -translate-x-full lg:visible"
        )}
      >
        <div className={clsx("flex h-14 items-center px-4 lg:h-16", fullWidth && "lg:justify-center lg:px-0")}>
          <Logo to="/app" className={fullWidth ? "lg:[&>span]:sr-only" : undefined} />
        </div>
        <div className={clsx("flex-1 overflow-y-auto px-3 py-2", fullWidth && "lg:px-2")}>
          <NavItems rail={fullWidth} onNavigate={() => setMobileOpen(false)} />
        </div>
        <UserFooter rail={fullWidth} />
      </nav>

      <main id="main-content" tabIndex={-1} className={clsx("min-w-0 flex-1", !fullWidth && "px-4 py-6 sm:px-6 lg:px-10 lg:py-10")}>
        {fullWidth ? (
          <Outlet />
        ) : (
          <div className={clsx("mx-auto", wide ? "max-w-6xl" : "max-w-4xl")}>
            <Outlet />
          </div>
        )}
      </main>
    </div>
  );
}
