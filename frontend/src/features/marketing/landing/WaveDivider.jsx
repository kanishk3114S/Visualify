/** Crisp vector transition divider between the dark hero band and warm canvas. */
export function WaveDivider({ className = "text-canvas" }) {
  return (
    <div className={`w-full overflow-hidden leading-none ${className}`} aria-hidden="true">
      <svg viewBox="0 0 1440 56" className="block h-8 w-full sm:h-12" preserveAspectRatio="none">
        <path
          fill="currentColor"
          d="M0,24 C240,56 480,0 720,24 C960,48 1200,12 1440,32 L1440,56 L0,56 Z"
        />
      </svg>
    </div>
  );
}
