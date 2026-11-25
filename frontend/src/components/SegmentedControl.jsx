import { useRef } from "react";
import clsx from "clsx";

/**
 * Accessible segmented control (WAI-ARIA radiogroup) with arrow-key navigation
 * and tactile active pill styling.
 *
 * @param {object} props
 * @param {string} props.label  Accessible radiogroup label
 * @param {string} props.value  Currently selected option value
 * @param {(next: string) => void} props.onChange
 * @param {Array<{ value: string, label: string, ariaLabel?: string, icon?: any, disabled?: boolean }>} props.options
 * @param {"sm" | "md"} [props.size]
 * @param {boolean} [props.iconOnly]
 */
export function SegmentedControl({
  label,
  value,
  onChange,
  options,
  size = "md",
  iconOnly = false,
  className,
  testId,
}) {
  const refs = useRef([]);

  function onKeyDown(e, index) {
    const enabled = options.map((o, i) => (!o.disabled ? i : -1)).filter((i) => i !== -1);
    if (enabled.length === 0) return;
    const pos = enabled.indexOf(index);
    let targetIdx = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      targetIdx = enabled[(pos + 1) % enabled.length];
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      targetIdx = enabled[(pos - 1 + enabled.length) % enabled.length];
    } else if (e.key === "Home") {
      targetIdx = enabled[0];
    } else if (e.key === "End") {
      targetIdx = enabled[enabled.length - 1];
    }
    if (targetIdx !== null) {
      e.preventDefault();
      onChange(options[targetIdx].value);
      refs.current[targetIdx]?.focus();
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      data-testid={testId}
      className={clsx(
        "inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-lg border border-stone-300 bg-stone-100/80 p-0.5 shadow-2xs",
        className
      )}
    >
      {options.map((opt, idx) => {
        const selected = opt.value === value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              refs.current[idx] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={opt.ariaLabel ?? opt.label}
            title={iconOnly ? opt.ariaLabel ?? opt.label : undefined}
            disabled={opt.disabled}
            tabIndex={selected ? 0 : -1}
            onClick={() => !opt.disabled && onChange(opt.value)}
            onKeyDown={(e) => onKeyDown(e, idx)}
            className={clsx(
              "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-all duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50",
              size === "sm"
                ? iconOnly
                  ? "p-1.5"
                  : "h-7 px-2 text-xs sm:px-2.5"
                : iconOnly
                  ? "p-2"
                  : "h-8 px-2.5 text-xs sm:px-3 sm:text-sm",
              selected
                ? "bg-surface text-stone-900 shadow-xs ring-1 ring-stone-200/80"
                : "text-stone-600 hover:text-stone-900"
            )}
          >
            {Icon && (
              <Icon
                className={clsx("h-4 w-4 shrink-0", selected ? "text-accent-700" : "text-stone-500")}
                aria-hidden="true"
              />
            )}
            {!iconOnly && <span className="whitespace-nowrap">{opt.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
