function LegalPage({ title, updated, children }) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight text-stone-900">{title}</h1>
      <p className="mt-2 text-sm text-stone-500">Last updated {updated}</p>
      <p className="mt-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Working draft for early access. It will be reviewed before Visualify launches publicly.
      </p>
      <div className="mt-8 space-y-6 text-sm leading-relaxed text-stone-700 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-stone-900 [&_li]:ml-5 [&_li]:list-disc">
        {children}
      </div>
    </article>
  );
}

export function PrivacyPage() {
  return (
    <LegalPage title="Privacy notice" updated="25 November 2026">
      <section>
        <h2>What we collect today</h2>
        <ul>
          <li>Your account email address and sign-in method (email/password or Google), managed by our authentication provider, Supabase.</li>
          <li>Profile details you choose to add: display name, username, bio and profile photo.</li>
          <li>Basic preferences such as learning level and default export format.</li>
        </ul>
      </section>
      <section>
        <h2>How your data is stored</h2>
        <ul>
          <li>Passwords are never stored by Visualify; they are hashed by Supabase Auth.</li>
          <li>Profile photos are re-encoded (which removes location and camera metadata) and kept in private storage. They are only shown through short-lived links to you.</li>
          <li>Database access rules ensure each account can only read and change its own profile.</li>
        </ul>
      </section>
      <section>
        <h2>AI processing</h2>
        <p>
          Visual generation is not live yet. Before it launches, this notice will describe exactly what prompts and files
          are sent to the AI provider. Your content will not be used to train models without separate, explicit opt-in.
        </p>
      </section>
      <section>
        <h2>Your choices</h2>
        <p>
          You can edit or remove your profile details and photo at any time from your profile page. Self-service account
          deletion is planned; until then, contact the Visualify team to have your account removed.
        </p>
      </section>
    </LegalPage>
  );
}

export function TermsPage() {
  return (
    <LegalPage title="Terms of service" updated="25 November 2026">
      <section>
        <h2>Early access</h2>
        <p>
          Visualify is provided as an early-access service. Features may change, and some described features are not yet
          available.
        </p>
      </section>
      <section>
        <h2>Your account</h2>
        <p>Keep your sign-in details secure. You are responsible for activity on your account.</p>
      </section>
      <section>
        <h2>Acceptable use</h2>
        <ul>
          <li>Don't upload content you don't have the right to use.</li>
          <li>Don't upload unlawful, harmful or harassing content, including in profile photos or bios.</li>
          <li>Don't attempt to access other users' data or disrupt the service.</li>
        </ul>
      </section>
      <section>
        <h2>Your content</h2>
        <p>You keep ownership of what you create and upload. We only use it to provide the service to you.</p>
      </section>
    </LegalPage>
  );
}
