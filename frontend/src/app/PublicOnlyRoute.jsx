import { Navigate, Outlet, useSearchParams } from "react-router-dom";
import { useAuth } from "../features/auth/AuthContext.jsx";
import { FullPageSpinner } from "../components/Spinner.jsx";
import { sanitizeReturnTo } from "../lib/returnTo.js";

/**
 * Wraps /login, /signup and /forgot-password: signed-in users are sent to the
 * validated returnTo (or /app). This is also how a successful sign-in redirects.
 */
export function PublicOnlyRoute() {
  const { status } = useAuth();
  const [params] = useSearchParams();

  if (status === "loading") return <FullPageSpinner label="Checking your session" />;
  if (status === "authenticated") return <Navigate to={sanitizeReturnTo(params.get("returnTo"))} replace />;
  return <Outlet />;
}
