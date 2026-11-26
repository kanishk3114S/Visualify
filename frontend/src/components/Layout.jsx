import { forwardRef } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { ArrowLeft } from "lucide-react";

import { BrandMark } from "../brand/BrandMark.jsx";

/** Wordmark used across public and app layouts. */
export function Logo({ to = "/", className, variant = "default" }) {
  return (
    <Link
      to={to}
      viewTransition
      className={clsx(
        "group inline-flex items-center gap-2.5 font-semibold text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas rounded-md",
        className
      )}
    >
      <span className="inline-flex transition-transform duration-200 ease-[var(--ease-spring)] group-hover:-rotate-3 group-active:scale-95">
        <BrandMark size={28} variant={variant} decorative />
      </span>
      <span className="font-display text-lg tracking-tight">Visualify</span>
    </Link>
  );
}

/** White content card. */
export const Card = forwardRef(function Card({ as: Tag = "section", className, children, ...props }, ref) {
  return (
    <Tag ref={ref} className={clsx("rounded-xl border border-stone-200 bg-surface shadow-xs", className)} {...props}>
      {children}
    </Tag>
  );
});

/** Page heading block used at the top of every app page. */
export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">{title}</h1>
        {description && <p className="text-sm text-stone-600">{description}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

/** Small status pill, e.g. "Available now" / "Coming later". */
export function Badge({ tone = "neutral", className, children, ...props }) {
  const tones = {
    neutral: "bg-stone-100 text-stone-700 ring-stone-200",
    accent: "bg-accent-50 text-accent-800 ring-accent-100",
    soon: "bg-amber-50 text-amber-900 ring-amber-200",
  };
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", tones[tone], className)} {...props}>
      {children}
    </span>
  );
}

/** Back link shown on settings sub-pages. */
export function BackToSettings() {
  return (
    <Link to="/app/settings" className="mb-4 inline-flex items-center gap-1.5 text-sm text-stone-600 hover:text-stone-900">
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Settings
    </Link>
  );
}
