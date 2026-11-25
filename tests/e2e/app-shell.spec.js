import { test, expect } from "@playwright/test";
import { makeProfile, mockApi, signInWithFakeSession, trackErrors, watchForSelector, TEST_USER } from "./support/mockBackend.js";

test.describe("Phase 1: public pages", () => {
  test("landing page renders with no console or page errors", async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/visual notes you can edit/i);
    await expect(page.getByRole("link", { name: "Create a free account" })).toHaveAttribute("href", "/signup");
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
    await expect(page.getByTestId("landing-showcase")).toBeVisible();
    await expect(page.getByTestId("showcase-callout")).toContainText("Client:");
    await page.waitForLoadState("networkidle");
    expect(errors).toEqual([]);
  });

  test("features, privacy, terms and 404 pages render", async ({ page }) => {
    const errors = trackErrors(page);
    for (const [path, heading] of [
      ["/features", "Features"],
      ["/privacy", "Privacy notice"],
      ["/terms", "Terms of service"],
      ["/404", "Page not found"],
      ["/definitely/not/a/page", "Page not found"],
    ]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    }
    // Release policy: unreleased features are labelled, not advertised as available.
    await page.goto("/features");
    await expect(page.getByText("Available now")).toHaveCount(9);
    expect(errors).toEqual([]);
  });

  test("landing page has no horizontal overflow on a phone-sized viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    for (const path of ["/", "/features", "/login", "/signup"]) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} overflows horizontally`).toBeLessThanOrEqual(0);
    }
  });
});

test.describe("Phase 1: route guard", () => {
  for (const path of ["/app", "/app/profile", "/app/settings/account"]) {
    test(`${path} redirects signed-out visitors to /login without flashing protected UI`, async ({ page }) => {
      await watchForSelector(page, '[data-testid="app-shell"]');
      await page.goto(path);
      await expect(page).toHaveURL(`/login?returnTo=${encodeURIComponent(path)}`);
      await expect(page.getByRole("heading", { name: "Sign in to Visualify" })).toBeVisible();
      expect(await page.evaluate(() => window.__sawProtected)).toBe(false);
    });
  }

  test("preserves query strings in returnTo", async ({ page }) => {
    await page.goto("/app/settings?tab=security");
    await expect(page).toHaveURL(`/login?returnTo=${encodeURIComponent("/app/settings?tab=security")}`);
  });
});

test.describe("Phase 1: open-redirect protection", () => {
  const hostile = [
    "https://evil.com",
    "//evil.com",
    "/\\evil.com",
    "/\t/evil.com", // browsers strip tabs/newlines -> "//evil.com"
    "/\n/evil.com",
    "javascript:alert(document.domain)",
    "http://127.0.0.1:5174.evil.com/app",
  ];

  for (const target of hostile) {
    test(`signed-in user with returnTo=${target} stays on this origin at /app`, async ({ page }) => {
      await signInWithFakeSession(page);
      await mockApi(page);
      const navigations = [];
      page.on("framenavigated", (f) => f === page.mainFrame() && navigations.push(f.url()));
      await page.goto(`/login?returnTo=${encodeURIComponent(target)}`);
      await expect(page).toHaveURL("/app");
      await expect(page.getByTestId("app-shell")).toBeVisible();
      for (const url of navigations) expect(new URL(url).origin).toBe("http://127.0.0.1:5174");
    });
  }

  test("a valid in-app returnTo is honoured after sign-in", async ({ page }) => {
    await signInWithFakeSession(page);
    await mockApi(page);
    await page.goto(`/login?returnTo=${encodeURIComponent("/app/settings/preferences")}`);
    await expect(page).toHaveURL("/app/settings/preferences");
    await expect(page.getByRole("heading", { name: "Preferences" })).toBeVisible();
  });
});

test.describe("Phase 1: auth form validation", () => {
  test("login shows accessible inline errors for empty and invalid input", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const email = page.getByLabel("Email");
    const password = page.getByLabel("Password");
    await expect(email).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("Enter your email address.")).toBeVisible();
    await expect(page.getByText("Enter your password.")).toBeVisible();
    await expect(password).toHaveAttribute("aria-invalid", "true");
    // Error text is programmatically associated with the field.
    const describedBy = await email.getAttribute("aria-describedby");
    await expect(page.locator(`[id="${describedBy}"]`)).toHaveText("Enter your email address.");

    await email.fill("not-an-email");
    await password.fill("x");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("Enter a valid email address.")).toBeVisible();
    await expect(page.getByText("Enter your password.")).toHaveCount(0);
  });

  test("signup validates name, email, password strength and confirmation", async ({ page }) => {
    await page.goto("/signup");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Enter your name.")).toBeVisible();
    await expect(page.getByText("Enter your email address.")).toBeVisible();

    await page.getByLabel("Name").fill("Ada");
    await page.getByLabel("Email").fill("ada@example.test");
    await page.getByRole("textbox", { name: "Password", exact: true }).fill("short");
    await page.getByLabel("Confirm password").fill("different");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Use at least 8 characters.")).toBeVisible();
    await expect(page.getByText("Passwords don't match.")).toBeVisible();

    await page.getByRole("textbox", { name: "Password", exact: true }).fill("onlyletters");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Include at least one letter and one number.")).toBeVisible();
  });

  test("forgot-password validates email before sending", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText("Enter your email address.")).toBeVisible();
  });

  test("reset-password without a recovery session explains the link is invalid", async ({ page }) => {
    await page.goto("/reset-password");
    await expect(page.getByTestId("reset-link-invalid")).toBeVisible();
    await expect(page.getByRole("link", { name: "Request a new link" })).toHaveAttribute("href", "/forgot-password");
  });

  test("auth callback shows a safe error for a failed OAuth/email link", async ({ page }) => {
    await page.goto("/auth/callback?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid");
    await expect(page.getByTestId("auth-callback-error")).toContainText("This link has expired.");
    // The raw provider description is never echoed into the page.
    await expect(page.getByText("Email link is invalid")).toHaveCount(0);
  });
});

test.describe("Phase 1: authenticated shell and profile (mocked API)", () => {
  test("dashboard greets the user with real profile data and sends a Bearer token", async ({ page }) => {
    const errors = trackErrors(page);
    await signInWithFakeSession(page);
    const api = await mockApi(page);
    await page.goto("/app");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Ada Student$/);
    await expect(page.getByTestId("shell-user-name")).toHaveText("Ada Student");
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "My Notes" })).toHaveAttribute("href", "/app/notes");
    const meCall = api.calls.find((c) => c.path === "/api/v1/me");
    expect(meCall.auth).toMatch(/^Bearer eyJ/);
    expect(meCall.requestId).toMatch(/^web_[0-9a-f]{32}$/);
    expect(errors).toEqual([]);
  });

  test("authenticated users visiting /login or /signup go to /app", async ({ page }) => {
    await signInWithFakeSession(page);
    await mockApi(page);
    await page.goto("/signup");
    await expect(page).toHaveURL("/app");
  });

  test("edits profile fields, sends only changed fields, and shows success", async ({ page }) => {
    await signInWithFakeSession(page);
    const api = await mockApi(page);
    await page.goto("/app/profile");
    const save = page.getByRole("button", { name: "Save changes" });
    await expect(save).toBeDisabled();

    await page.getByLabel("Username").fill("ada_learns");
    await page.getByLabel("Bio").fill("Studying operating systems.");
    await expect(page.getByText("27 / 300")).toBeVisible();
    await save.click();

    await expect(page.getByTestId("toast")).toContainText("Profile saved.");
    const patch = api.calls.find((c) => c.method === "PATCH");
    expect(patch.body).toEqual({ username: "ada_learns", bio: "Studying operating systems." });
    await expect(save).toBeDisabled();
    expect(api.profile.username).toBe("ada_learns");
  });

  test("shows client validation and a server USERNAME_TAKEN error on the field", async ({ page }) => {
    await signInWithFakeSession(page);
    await mockApi(page, { takenUsernames: ["taken_name"] });
    await page.goto("/app/profile");

    await page.getByLabel("Username").fill("no spaces!");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("3-30 characters: letters, numbers or underscores.").last()).toBeVisible();

    await page.getByLabel("Username").fill("taken_name");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("That username is already taken.")).toBeVisible();
    await expect(page.getByLabel("Username")).toHaveAttribute("aria-invalid", "true");
  });

  test("avatar: rejects a non-image client-side, previews, uploads and removes with confirmation", async ({ page }) => {
    await signInWithFakeSession(page);
    const api = await mockApi(page);
    await page.goto("/app/profile");
    const input = page.getByTestId("avatar-file-input");

    await input.setInputFiles({ name: "notes.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7") });
    await expect(page.getByText("Choose a JPEG, PNG or WebP image.")).toBeVisible();

    await input.setInputFiles({ name: "huge.png", mimeType: "image/png", buffer: Buffer.alloc(2 * 1024 * 1024 + 1) });
    await expect(page.getByText("Images must be 2 MB or smaller.")).toBeVisible();

    // 1x1 PNG
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64"
    );
    await input.setInputFiles({ name: "me.png", mimeType: "image/png", buffer: png });
    await expect(page.getByText("Preview")).toBeVisible();
    await page.getByRole("button", { name: "Save photo" }).click();
    await expect(page.getByTestId("toast").first()).toContainText("Profile photo updated.");
    const upload = api.calls.find((c) => c.path === "/api/v1/me/avatar" && c.method === "POST");
    expect(upload.contentType).toMatch(/^multipart\/form-data; boundary=/);

    await page.getByRole("button", { name: "Remove" }).click();
    const dialog = page.getByRole("dialog", { name: "Remove profile photo?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    expect(api.calls.some((c) => c.method === "DELETE")).toBe(false);

    await page.getByRole("button", { name: "Remove" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove photo" }).click();
    await expect(page.getByText("Profile photo removed.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload photo" })).toBeVisible();
  });

  test("preferences save through PATCH /me", async ({ page }) => {
    await signInWithFakeSession(page);
    const api = await mockApi(page);
    await page.goto("/app/settings/preferences");
    await page.getByLabel("Learning level").selectOption("postgraduate");
    await page.getByRole("button", { name: "Save preferences" }).click();
    await expect(page.getByText("Preferences saved.")).toBeVisible();
    expect(api.calls.find((c) => c.method === "PATCH").body).toEqual({
      preferences: { theme: "light", learningLevel: "postgraduate", defaultExportFormat: "png" },
    });
  });

  test("account page shows the email and confirms before signing out everywhere", async ({ page }) => {
    await signInWithFakeSession(page);
    await mockApi(page);
    await page.goto("/app/settings/account");
    await expect(page.getByTestId("account-email")).toHaveText(TEST_USER.email);
    await page.getByRole("button", { name: "Sign out everywhere" }).click();
    await expect(page.getByRole("dialog", { name: "Sign out everywhere?" })).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("sign out clears the session and returns to /login", async ({ page }) => {
    await signInWithFakeSession(page);
    await mockApi(page);
    // Supabase logout endpoint is unreachable in E2E; local sign-out must still succeed.
    await page.route("http://127.0.0.1:54399/**", (route) => route.fulfill({ status: 204, body: "" }));
    await page.goto("/app");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL("/login");
    expect(await page.evaluate((k) => window.localStorage.getItem(k), "visualify-auth")).toBeNull();
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login\?returnTo=/);
  });

  test("shows a retryable error state when the API fails", async ({ page }) => {
    await signInWithFakeSession(page);
    await mockApi(page, { failMe: true, profile: makeProfile() });
    await page.goto("/app/profile");
    await expect(page.getByTestId("profile-error")).toContainText("We couldn't complete that request.", { timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  test("mobile navigation opens, is keyboard-dismissable, and the closed drawer is not focusable", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await signInWithFakeSession(page);
    await mockApi(page);
    await page.goto("/app");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav).toBeHidden();
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(nav).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(nav).toBeHidden();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
