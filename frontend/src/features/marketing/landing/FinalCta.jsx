import { ButtonLink } from "../../../components/Button.jsx";
import { Reveal } from "../../../motion/Reveal.jsx";

/** Focused bottom call-to-action band. */
export function FinalCta() {
  return (
    <section className="mx-auto max-w-6xl px-4 pb-20 pt-4 sm:px-6">
      <Reveal y={12} className="rounded-2xl bg-hero px-6 py-12 text-center text-white shadow-lg sm:px-12">
        <h2 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
          Ready to map your next topic visually?
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-[#d6d3d1] sm:text-base">
          Create a free account to generate flowcharts, mind maps, and study packs — then edit every block on canvas.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <ButtonLink
            to="/signup"
            size="lg"
            className="!bg-[#2dd4bf] !text-[#04211e] hover:!bg-[#5eead4] active:!bg-[#14b8a6]"
          >
            Get started free
          </ButtonLink>
          <ButtonLink
            to="/features"
            variant="secondary"
            size="lg"
            className="!border-[#134e4a] !bg-[#0c312e] !text-white hover:!border-[#2dd4bf] hover:!bg-[#134e4a]"
          >
            Explore features
          </ButtonLink>
        </div>
      </Reveal>
    </section>
  );
}
