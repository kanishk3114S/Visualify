import { ButtonLink } from "../../components/Button.jsx";
import { useAuth } from "../auth/AuthContext.jsx";

export function NotFoundPage() {
  const { status } = useAuth();
  const home = status === "authenticated" ? "/app" : "/";
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center">
      <p className="text-sm font-semibold text-accent-700">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-stone-900">Page not found</h1>
      <p className="mt-3 text-stone-600">The page you're looking for doesn't exist or is no longer available.</p>
      <ButtonLink to={home} className="mt-8">
        {status === "authenticated" ? "Back to dashboard" : "Back to home"}
      </ButtonLink>
    </div>
  );
}
