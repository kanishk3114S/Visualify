import { Hero } from "./landing/Hero.jsx";
import { InputsStrip } from "./landing/InputsStrip.jsx";
import { HowItWorks } from "./landing/HowItWorks.jsx";
import { StudyDemo } from "./landing/StudyDemo.jsx";
import { DiagramMarquee } from "./landing/DiagramMarquee.jsx";
import { PrivacyBand } from "./landing/PrivacyBand.jsx";
import { FinalCta } from "./landing/FinalCta.jsx";

export function LandingPage() {
  return (
    <>
      <Hero />
      <InputsStrip />
      <HowItWorks />
      <StudyDemo />
      <DiagramMarquee />
      <PrivacyBand />
      <FinalCta />
    </>
  );
}
