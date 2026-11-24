import { useEffect, useState } from "react";
import clsx from "clsx";

const SIZES = { sm: "h-8 w-8 text-xs", md: "h-10 w-10 text-sm", lg: "h-20 w-20 text-2xl", xl: "h-28 w-28 text-3xl" };

export function initialsFor(name = "", fallback = "") {
  const source = (name || fallback || "?").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : source.slice(0, 2);
  return letters.toUpperCase();
}

/** Shows the (signed) avatar image, falling back to initials if absent or broken. */
export function Avatar({ src, name, fallbackText, size = "md", className }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  const showImage = src && !broken;
  return (
    <span
      className={clsx(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent-100 font-semibold text-accent-900 ring-1 ring-stone-200",
        SIZES[size],
        className
      )}
    >
      {showImage ? (
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
        />
      ) : (
        <span aria-hidden="true">{initialsFor(name, fallbackText)}</span>
      )}
    </span>
  );
}
