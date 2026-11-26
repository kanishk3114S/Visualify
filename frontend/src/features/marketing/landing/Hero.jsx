import { Check } from "lucide-react";
import { ButtonLink } from "../../../components/Button.jsx";
import { BrandMark } from "../../../brand/BrandMark.jsx";
import { Reveal } from "../../../motion/Reveal.jsx";
import { HeroStage } from "./HeroStage.jsx";
import { WaveDivider } from "./WaveDivider.jsx";

const CAPABILITIES = [
  "Editable Excalidraw canvas",
  "PDF page ranges & handwritten photos",
  "Export PNG, SVG & .excalidraw",
];

/** Signature dark hero band paired with the interactive diagram preview stage. */
export function Hero() {
  return (
    <section
      className="relative overflow-hidden bg-hero text-white"
      style={{
        backgroundImage: "radial-gradient(rgba(94, 234, 212, 0.08) 1px, transparent 1px)",
        backgroundSize: "24px 24px",
      }}
    >
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-12 sm:px-6 lg:grid-cols-12 lg:gap-12 lg:pb-20 lg:pt-20">
        <div className="lg:col-span-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#134e4a] bg-[#0c312e] px-3 py-1 text-xs font-medium text-[#99f6e4]">
            <BrandMark size={16} variant="inverse" decorative />
            <span>Visual Learning Workspace</span>
          </div>

          <h1 className="mt-5 font-display text-4xl font-bold leading-[1.07] tracking-tight text-white sm:text-5xl">
            Turn study topics into <span className="text-[#5eead4]">visual notes you can edit.</span>
          </h1>

          <p className="mt-5 max-w-xl text-base leading-relaxed text-[#d6d3d1] sm:text-lg">
            Describe a concept, select pages from a PDF, or snap handwritten notes. Visualify plans the structure, draws
            an editable Excalidraw diagram, and builds quizzes and flashcards alongside it.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <ButtonLink
              to="/signup"
              size="lg"
              className="!bg-[#2dd4bf] !text-[#04211e] hover:!bg-[#5eead4] active:!bg-[#14b8a6]"
            >
              Create a free account
            </ButtonLink>
            <ButtonLink
              to="/features"
              variant="secondary"
              size="lg"
              className="!border-[#134e4a] !bg-[#0c312e] !text-white hover:!border-[#2dd4bf] hover:!bg-[#134e4a]"
            >
              See all features
            </ButtonLink>
          </div>

          <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-[#d6d3d1]">
            {CAPABILITIES.map((label) => (
              <li key={label} className="inline-flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 shrink-0 text-[#5eead4]" aria-hidden="true" />
                <span>{label}</span>
              </li>
            ))}
          </ul>
        </div>

        <Reveal immediate delay={60} y={14} className="lg:col-span-6">
          <HeroStage />
        </Reveal>
      </div>

      <WaveDivider className="text-canvas" />
    </section>
  );
}
