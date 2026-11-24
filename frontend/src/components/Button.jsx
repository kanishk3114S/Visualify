import { forwardRef } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { Spinner } from "./Spinner.jsx";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap";

const VARIANTS = {
  primary: "bg-accent-700 text-white hover:bg-accent-800 active:bg-accent-900",
  secondary: "border border-stone-300 bg-white text-stone-800 hover:bg-stone-50 active:bg-stone-100",
  ghost: "text-stone-700 hover:bg-stone-100 active:bg-stone-200",
  danger: "bg-red-700 text-white hover:bg-red-800 active:bg-red-900",
  dangerOutline: "border border-red-300 bg-white text-red-700 hover:bg-red-50",
};

const SIZES = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-11 px-5 text-base",
};

export function buttonClasses({ variant = "primary", size = "md", className } = {}) {
  return clsx(BASE, VARIANTS[variant], SIZES[size], className);
}

/** Button with a built-in pending state that keeps its accessible name. */
export const Button = forwardRef(function Button(
  { variant = "primary", size = "md", loading = false, loadingText, disabled, className, children, type = "button", ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, className })}
      {...props}
    >
      {loading && <Spinner size="sm" decorative />}
      <span className="inline-flex items-center gap-2">{loading && loadingText ? loadingText : children}</span>
    </button>
  );
});

/** Router link styled as a button. */
export function ButtonLink({ to, variant = "primary", size = "md", className, children, ...props }) {
  return (
    <Link to={to} className={buttonClasses({ variant, size, className })} {...props}>
      {children}
    </Link>
  );
}
