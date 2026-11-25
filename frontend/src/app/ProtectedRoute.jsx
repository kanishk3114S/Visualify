import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../features/auth/AuthContext.jsx";
import { FullPageSpinner } from "../components/Spinner.jsx";
import { sanitizeReturnTo } from "../lib/returnTo.js";

/**
 * Guards /app/*. Renders nothing protected until the Supabase session has been
 * initialised (FR-AUTH-05), then either renders the route or redirects to
 * /login with a validated returnTo.
 */
export function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") return <FullPageSpinner label="Checking your session" />;
  if (status !== "authenticated") {
    const returnTo = sanitizeReturnTo(`${location.pathname}${location.search}${location.hash}`);
    return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }
  return <Outlet />;
}
