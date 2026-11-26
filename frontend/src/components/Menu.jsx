import { useEffect, useId, useRef, useState } from "react";
import clsx from "clsx";
import { MoreHorizontal } from "lucide-react";

/**
 * Accessible "more actions" menu: button[aria-haspopup] + role=menu with
 * menuitems. Arrow keys move, Escape closes and restores focus, clicking
 * outside closes. items: [{ label, icon, onSelect, danger?, disabled? }]
 */
export function ActionMenu({ label, items, align = "right", className }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const list = () => [...(menuRef.current?.querySelectorAll('[role="menuitem"]:not([disabled])') ?? [])];
    list()[0]?.focus();
    const onPointer = (e) => {
      if (!menuRef.current?.contains(e.target) && !buttonRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      const items = list();
      const i = items.indexOf(document.activeElement);
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        items[(i + 1) % items.length]?.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        items[(i - 1 + items.length) % items.length]?.focus();
      } else if (e.key === "Tab") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={clsx("relative", className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="rounded-md p-1.5 text-stone-600 hover:bg-stone-100 hover:text-stone-900"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          data-vf-menu
          aria-label={label}
          className={clsx("absolute z-30 mt-1 w-48 rounded-lg border border-stone-200 bg-surface p-1 shadow-lg", align === "right" ? "right-0" : "left-0")}
        >
          {items.map(({ label: itemLabel, icon: Icon, onSelect, danger, disabled }) => (
            <button
              key={itemLabel}
              type="button"
              role="menuitem"
              disabled={disabled}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onSelect();
              }}
              className={clsx(
                "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-stone-100 focus-visible:bg-stone-100 disabled:opacity-50",
                danger ? "text-red-700" : "text-stone-800"
              )}
            >
              {Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
              {itemLabel}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
