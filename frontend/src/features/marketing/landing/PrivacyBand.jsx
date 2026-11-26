import { Link } from "react-router-dom";
import { Database, Lock, ShieldCheck, Trash2 } from "lucide-react";
import { Reveal } from "../../../motion/Reveal.jsx";

const TRUST_ITEMS = [
  {
    icon: ShieldCheck,
    title: "PostgreSQL Row-Level Security",
    text: "Notes, folders, study packs, and generation jobs stay strictly scoped per authenticated user.",
  },
  {
    icon: Lock,
    title: "Private storage buckets",
    text: "Uploaded PDFs, images, and exported diagrams live behind short-lived signed access — never public URLs.",
  },
  {
    icon: Trash2,
    title: "Self-serve account deletion",
    text: "Remove your profile, files, and generated canvases cleanly in one action whenever you choose.",
  },
  {
    icon: Database,
    title: "Telemetry without prompt text",
    text: "Aggregated operational metrics track timings and token costs without logging user prompts or uploads.",
  },
];

/** Honest security & privacy architecture summary matching verified repo behavior. */
export function PrivacyBand() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6" aria-labelledby="privacy-heading">
      <Reveal y={10} className="rounded-2xl border border-stone-200 bg-surface p-6 shadow-xs sm:p-10">
        <div className="flex flex-col justify-between gap-4 border-b border-stone-200 pb-6 md:flex-row md:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-accent-700">Privacy &amp; ownership</p>
            <h2 id="privacy-heading" className="mt-1.5 font-display text-2xl font-bold tracking-tight text-stone-900">
              Built so your study notes stay yours
            </h2>
          </div>
          <Link to="/privacy" viewTransition className="text-sm font-medium text-accent-700 hover:text-accent-800 hover:underline">
            Read privacy notice →
          </Link>
        </div>

        <dl className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {TRUST_ITEMS.map(({ icon: Icon, title, text }) => (
            <div key={title} className="space-y-1.5">
              <Icon className="h-5 w-5 text-accent-700" aria-hidden="true" />
              <dt className="text-sm font-semibold text-stone-900">{title}</dt>
              <dd className="text-xs leading-relaxed text-stone-600">{text}</dd>
            </div>
          ))}
        </dl>
      </Reveal>
    </section>
  );
}
