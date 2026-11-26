function LegalPage({ title, updated, children }) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight text-stone-900">{title}</h1>
      <p className="mt-2 text-sm text-stone-500">Last updated {updated}</p>
      <p className="mt-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="legal-draft-notice">
        Pre-launch draft notice: this document is awaiting formal legal counsel review before general public launch.
      </p>
      <div className="mt-8 space-y-6 text-sm leading-relaxed text-stone-700 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-stone-900 [&_li]:ml-5 [&_li]:list-disc">
        {children}
      </div>
    </article>
  );
}

export function PrivacyPage() {
  return (
    <LegalPage title="Privacy notice" updated="26 November 2026">
      <section>
        <h2>What we collect and store</h2>
        <ul>
          <li>Account identity (email address and sign-in provider: email/password or Google), managed by Supabase Auth.</li>
          <li>Profile fields you choose to provide (display name, username, bio, preferences, and optional avatar image).</li>
          <li>Study content you create or upload: prompts, uploaded PDFs/images stored in private buckets, Excalidraw scenes, note versions, drafts, quizzes, flashcards, and revision guides.</li>
        </ul>
      </section>
      <section>
        <h2>AI provider processing</h2>
        <ul>
          <li>Prompts, selected PDF page text/page renders, EXIF-stripped note images, and note context used for study companion actions (Explain, Quiz, Flashcards, Revision Sheet, Ask, Section Regenerate) are transmitted server-side to Google Gemini for processing.</li>
          <li>Raw prompts, uploaded document contents, signed URLs, and emails are never written to application error logs or analytics events.</li>
          <li>Your study materials are not used by Visualify to train foundation models without separate explicit opt-in.</li>
        </ul>
      </section>
      <section>
        <h2>Usage metering and retention</h2>
        <ul>
          <li>Visualify records non-content operational usage counters (user UUID, operation type, timestamp, and non-PII unit count) in <code>usage_events</code> solely to enforce monthly quotas and measure reliability.</li>
          <li>Signed storage links expire automatically after 5–10 minutes; uploaded images strip EXIF camera/location metadata on ingest.</li>
          <li>Deleting a note removes its stored source/preview/export objects and note records.</li>
        </ul>
      </section>
      <section>
        <h2>Self-service account deletion</h2>
        <p>
          You can permanently delete your account at any time from{" "}
          <strong>Settings → Account → Delete account</strong> after re-authenticating and typing the confirmation phrase.
          Account deletion sweeps all owned files from private storage buckets and cascades removal of your profile, notes,
          versions, jobs, and study artifacts.
        </p>
      </section>
    </LegalPage>
  );
}

export function TermsPage() {
  return (
    <LegalPage title="Terms of service" updated="26 November 2026">
      <section>
        <h2>Service scope and AI disclaimers</h2>
        <p>
          Visualify generates editable diagrams, quizzes, flashcards, and study summaries using automated AI models. Outputs
          may contain inaccuracies and should be verified against authoritative course materials.
        </p>
      </section>
      <section>
        <h2>Your account, rate limits, and monthly quotas</h2>
        <ul>
          <li>Keep your credentials secure; you are responsible for activity performed under your account.</li>
          <li>To ensure fair availability and control compute costs, generation and AI companion actions are subject to per-user rate limits and configurable monthly usage quotas.</li>
        </ul>
      </section>
      <section>
        <h2>Acceptable use</h2>
        <ul>
          <li>Only upload PDFs, images, or text you have the right to process.</li>
          <li>Do not submit unlawful, harmful, or harassing content, attempt prompt injection to bypass system safeguards, or probe other users&apos; data.</li>
        </ul>
      </section>
      <section>
        <h2>Your content and deletion rights</h2>
        <p>
          You retain ownership of all notes and materials you upload or edit. Deleting a note or deleting your account removes
          your stored content and ends Visualify&apos;s access to it.
        </p>
      </section>
    </LegalPage>
  );
}
