import { ButtonLink } from "../../components/Button.jsx";
import { BrandMark } from "../../brand/BrandMark.jsx";
import { Reveal } from "../../motion/Reveal.jsx";
import { useAuth } from "../auth/AuthContext.jsx";

export function NotFoundPage() {
  const { status } = useAuth();
  const home = status === "authenticated" ? "/app" : "/";
  return (
    <Reveal as="div" className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center">
      <div className="mb-5 flex items-center justify-center rounded-2xl border border-stone-200 bg-surface p-4 shadow-xs">
        <BrandMark size={40} decorative className="motion-safe:animate-calm-pulse" />
      </div>
      <p className="text-sm font-semibold text-accent-700">404</p>
      <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-stone-900">Page not found</h1>
      <p className="mt-3 text-stone-600">The page you&apos;re looking for doesn&apos;t exist or is no longer available.</p>
      <ButtonLink to={home} className="mt-8">
        {status === "authenticated" ? "Back to dashboard" : "Back to home"}
      </ButtonLink>
    </Reveal>
  );
}
