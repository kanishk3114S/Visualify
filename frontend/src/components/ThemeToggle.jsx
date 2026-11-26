import { useEffect, useId, useRef, useState } from "react";
import clsx from "clsx";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useThemeChooser } from "../app/ThemeContext.jsx";

const OPTIONS = [
  { mode: "light", label: "Light", icon: Sun },
  { mode: "dark", label: "Dark", icon: Moon },
  { mode: "system", label: "System", icon: Monitor },
];

/**
 * Accessible theme menu: a button (announces the current theme) that opens a
 * menu of Light / Dark / System radio items. Arrow keys move, Enter/Space
 * selects, Escape closes and returns focus to the button.
 */
export function ThemeToggle({ compact = false, className, align = "right" }) {
  const { mode, resolvedTheme, choose } = useThemeChooser();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();
  const current = OPTIONS.find((o) => o.mode === mode) ?? OPTIONS[2];
  const ResolvedIcon = resolvedTheme === "dark" ? Moon : Sun;

  useEffect(() => {
    if (!open) return undefined;
    const items = () => [...(menuRef.current?.querySelectorAll('[role="menuitemradio"]') ?? [])];
    items().find((el) => el.getAttribute("aria-checked") === "true")?.focus();
    const onDocPointer = (e) => {
      if (!menuRef.current?.contains(e.target) && !buttonRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      const list = items();
      const i = list.indexOf(document.activeElement);
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        list[(i + 1) % list.length]?.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        list[(i - 1 + list.length) % list.length]?.focus();
      } else if (e.key === "Tab") {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDocPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function select(next) {
    choose(next);
    setOpen(false);
    buttonRef.current?.focus();
  }

  return (
    <div className={clsx("relative", className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Theme: ${current.label}`}
        title={`Theme: ${current.label}`}
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          "inline-flex items-center gap-2 rounded-md text-sm text-stone-700 hover:bg-stone-100 hover:text-stone-900",
          compact ? "p-2" : "h-9 px-2.5"
        )}
        data-testid="theme-toggle"
      >
        <ResolvedIcon
          className={clsx(
            "h-4 w-4 transition-transform duration-300 ease-[var(--ease-spring)]",
            resolvedTheme === "dark" ? "-rotate-12" : "rotate-0"
          )}
          aria-hidden="true"
        />
        {!compact && <span>{current.label}</span>}
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          data-vf-menu
          aria-label="Theme"
          className={clsx(
            "absolute z-50 mt-1 w-40 rounded-lg border border-stone-200 bg-surface p-1 shadow-lg",
            align === "right" ? "right-0" : "left-0",
            align === "up" && "bottom-full mb-1 left-0"
          )}
        >
          {OPTIONS.map(({ mode: m, label, icon: Icon }) => (
            <button
              key={m}
              type="button"
              role="menuitemradio"
              aria-checked={mode === m}
              onClick={() => select(m)}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-stone-800 hover:bg-stone-100 focus-visible:bg-stone-100"
            >
              <Icon className="h-4 w-4 text-stone-600" aria-hidden="true" />
              <span className="flex-1">{label}</span>
              {mode === m && <Check className="h-4 w-4 text-accent-700" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
