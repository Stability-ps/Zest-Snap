import { test, expect, devices, type Browser, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";

/**
 * Email verification, password recovery and existing-account handling against a real Supabase Auth
 * server whose emails are captured by Mailpit (local stack with enable_confirmations = true and the
 * templates in supabase/templates). Every link is opened in a fresh browser context, as if clicked on
 * another device or in a mail app, so nothing depends on the signing-up browser's PKCE verifier.
 *
 *   AUTH_E2E_MAILPIT_URL=http://127.0.0.1:56424 AUTH_E2E_DB_CONTAINER=supabase_db_<id> \
 *     TEST_BASE_URL=http://127.0.0.1:3100 npx playwright test auth-email
 */
const MAILPIT = process.env.AUTH_E2E_MAILPIT_URL;
const DB_CONTAINER = process.env.AUTH_E2E_DB_CONTAINER;
test.skip(!MAILPIT, "Set AUTH_E2E_MAILPIT_URL to run against a local Supabase stack");
test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

const PASSWORD = "Zest-e2e-password-1";
const run = Date.now().toString(36);
const address = (tag: string) => `zs-${tag}-${run}@example.test`;

type MailSummary = { ID: string; Subject: string; To: { Address: string }[]; Created: string };
async function emailsTo(to: string): Promise<MailSummary[]> {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
  const body = (await res.json()) as { messages: MailSummary[] };
  return body.messages; // newest first
}
/** Waits for the `count`-th email to `to` and returns its subject and the link in it. */
async function linkFrom(to: string, count = 1) {
  let messages: MailSummary[] = [];
  await expect.poll(async () => (messages = await emailsTo(to)).length, { timeout: 20_000 }).toBeGreaterThanOrEqual(count);
  const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${messages[0].ID}`)).json()) as { HTML: string; Subject: string };
  const href = msg.HTML.match(/href="([^"]+\/auth\/confirm\?[^"]+)"/)?.[1];
  expect(href, "email contains an /auth/confirm link").toBeTruthy();
  return { subject: msg.Subject, link: href!.replace(/&amp;/g, "&") };
}
function sql(query: string) {
  if (!DB_CONTAINER) throw new Error("AUTH_E2E_DB_CONTAINER not set");
  return execFileSync("docker", ["exec", DB_CONTAINER, "psql", "-U", "postgres", "-tAc", query], { encoding: "utf8" }).trim();
}
async function signUp(page: Page, email: string, name = "E2E Tester") {
  await page.goto("/login?mode=signup");
  await page.getByPlaceholder("What should Zest call you?").fill(name);
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("At least 8 characters").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
}
async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("At least 8 characters").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}
/** Opens an email link in a brand-new context (another device / the mail app's browser). */
async function openElsewhere(browser: Browser, link: string, options = {}) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  await page.goto(link);
  return page;
}

const verified = address("verify");

test("sign-up asks to verify; the emailed link verifies on another device and continues into the app", async ({ page, browser }) => {
  await signUp(page, verified);
  await expect(page.getByText("Check your email to verify your Zest Snap account.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Resend (verification email|available in)/ })).toBeVisible();

  const { subject, link } = await linkFrom(verified);
  expect(subject).toBe("Verify your Zest Snap account");
  expect(link).toContain("/auth/confirm?token_hash=");
  expect(link).toContain("type=email");

  const other = await openElsewhere(browser, link);
  await expect(other).toHaveURL(/\/auth\/confirmed\?status=verified/);
  await expect(other.getByRole("heading", { name: "Email verified successfully." })).toBeVisible();
  await other.getByRole("button", { name: "Continue to Zest Snap" }).click();
  await expect(other).toHaveURL(/\/app/);
  expect(sql(`select email_confirmed_at is not null from auth.users where email = '${verified}'`)).toBe("t");
  await other.context().close();
});

test("a used verification link says so and offers resend and sign-in; signed in it says already verified", async ({ browser }) => {
  const { link } = await linkFrom(verified);
  const fresh = await openElsewhere(browser, link);
  await expect(fresh).toHaveURL(/status=expired/);
  await expect(fresh.getByRole("heading", { name: "This link has expired." })).toBeVisible();
  await expect(fresh.getByRole("button", { name: "Resend verification email" })).toBeVisible();
  await fresh.getByRole("link", { name: "Already verified? Sign in" }).click();
  await signIn(fresh, verified);
  await expect(fresh).toHaveURL(/\/app/);
  // Same browser, now signed in: the old link is recognised as already verified.
  await fresh.goto(link);
  await expect(fresh.getByRole("heading", { name: "Your email is already verified." })).toBeVisible();
  await expect(fresh.getByRole("button", { name: "Continue to Zest Snap" })).toBeVisible();
  await fresh.context().close();
});

test("malformed links are reported as invalid; unknown tokens as expired (Supabase can't tell them apart)", async ({ page }) => {
  await page.goto("/auth/confirm?token_hash=pkce_not-a-real-token&type=email");
  await expect(page.getByRole("heading", { name: "This link has expired." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resend verification email" })).toBeVisible();
  await page.goto("/auth/confirm?type=email");
  await expect(page.getByRole("heading", { name: "This link isn’t valid." })).toBeVisible();
  await page.goto("/auth/confirm?token_hash=abc&type=bogus");
  await expect(page.getByRole("heading", { name: "This link isn’t valid." })).toBeVisible();
});

test("an expired verification link is reported as expired and a resent link works", async ({ page, browser }) => {
  test.skip(!DB_CONTAINER, "needs AUTH_E2E_DB_CONTAINER to age the token");
  const email = address("expired");
  await signUp(page, email);
  await expect(page.getByText("Check your email to verify your Zest Snap account.")).toBeVisible();
  const { link } = await linkFrom(email);
  sql(`update auth.users set confirmation_sent_at = now() - interval '2 hours' where email = '${email}'`);
  const other = await openElsewhere(browser, link);
  await expect(other.getByRole("heading", { name: "This link has expired." })).toBeVisible();
  expect(sql(`select email_confirmed_at is null from auth.users where email = '${email}'`)).toBe("t");

  // Resend from the result screen (the address is typed there), then the cooldown blocks a second send.
  await other.getByPlaceholder("you@example.com").fill(email);
  await other.getByRole("button", { name: "Resend verification email" }).click();
  await expect(other.getByText(/a new verification link is on its way/)).toBeVisible();
  await expect(other.getByRole("button", { name: /Resend available in \d+s/ })).toBeDisabled();
  const resent = await linkFrom(email, 2);
  expect(resent.link).not.toBe(link);
  const third = await openElsewhere(browser, resent.link);
  await expect(third.getByRole("heading", { name: "Email verified successfully." })).toBeVisible();
  await third.context().close();
  await other.context().close();
});

test("signing in before verifying explains why and can resend; resend is rate limited", async ({ page }) => {
  const email = address("unverified");
  await signUp(page, email);
  await expect(page.getByText("Check your email to verify your Zest Snap account.")).toBeVisible();
  await linkFrom(email);
  // Supabase allows one email per address per minute; the button shows the wait instead of failing.
  await expect(page.getByRole("button", { name: /Resend available in \d+s/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Resend verification email" }).click();
  await expect(page.getByRole("button", { name: /Resend available in \d+s/ })).toBeDisabled();
  await expect(page.getByText(/Wait a few minutes|on its way/)).toBeVisible();

  await signIn(page, email);
  await expect(page.getByText("Verify your email first. Use the link we sent you, or resend it below.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Resend/ })).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("signing up again with a verified email guides to sign in and sends nothing", async ({ page }) => {
  const before = (await emailsTo(verified)).length;
  await signUp(page, verified);
  await expect(page.getByText("An account already exists for this email. Sign in instead, or reset your password if you’ve forgotten it.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await page.waitForTimeout(1500);
  expect((await emailsTo(verified)).length).toBe(before);
});

test("password recovery opens the reset screen (not the homepage), updates the password, and the link works once", async ({ page, browser }) => {
  const sent = (await emailsTo(verified)).length;
  await page.goto("/login?mode=forgot");
  await page.getByPlaceholder("you@example.com").fill(verified);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText("If this email has an account, a reset link is on its way.")).toBeVisible();
  const { subject, link } = await linkFrom(verified, sent + 1);
  expect(subject).toBe("Reset your Zest Snap password");
  expect(link).toContain("type=recovery");

  const other = await openElsewhere(browser, link);
  await expect(other).toHaveURL(/\/reset-password$/);
  await expect(other.getByRole("heading", { name: "Choose a new password." })).toBeVisible();
  await other.getByPlaceholder("At least 8 characters").fill("Zest-e2e-new-password-2");
  await other.getByRole("button", { name: "Update password" }).click();
  await expect(other.getByRole("heading", { name: "Password updated." })).toBeVisible();
  await other.getByRole("button", { name: "Continue to Zest Snap" }).click();
  await expect(other).toHaveURL(/\/app/);
  await other.context().close();

  const again = await openElsewhere(browser, link);
  await expect(again.getByRole("heading", { name: "This reset link can’t be used." })).toBeVisible();
  await expect(again.getByRole("link", { name: "Request a new reset link" })).toBeVisible();
  await again.context().close();

  await signIn(page, verified, "Zest-e2e-new-password-2");
  await expect(page).toHaveURL(/\/app/);
});

test("opening the reset screen without a valid link never shows the password form", async ({ page }) => {
  await page.goto("/reset-password");
  await expect(page.getByRole("heading", { name: "This reset link can’t be used." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Update password" })).toHaveCount(0);
});

test("legacy and error redirects land on the result screen", async ({ page }) => {
  await page.goto("/auth/callback?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
  await expect(page).toHaveURL(/\/auth\/confirmed\?status=expired/);
  await page.goto("/auth/callback?code=not-a-real-code");
  await expect(page).toHaveURL(/\/auth\/confirmed\?status=(invalid|unfinished)/);
  await page.goto("/login?error=access_denied&error_code=otp_expired");
  await expect(page).toHaveURL(/\/auth\/confirmed\?status=expired/);
});

for (const [name, device] of [
  ["Android phone (Pixel 7)", devices["Pixel 7"]],
  ["iPhone (Safari/WebKit)", devices["iPhone 14"]],
] as const) {
  test(`verification works on ${name}`, async ({ playwright }) => {
    const browserType = device.defaultBrowserType === "webkit" ? playwright.webkit : playwright.chromium;
    const browser = await browserType.launch();
    try {
      const context = await browser.newContext({ ...device, baseURL: process.env.TEST_BASE_URL || "http://localhost:3100" });
      const page = await context.newPage();
      const email = address(device.defaultBrowserType === "webkit" ? "ios" : "android");
      await signUp(page, email);
      await expect(page.getByText("Check your email to verify your Zest Snap account.")).toBeVisible();
      const { link } = await linkFrom(email);
      // The phone's mail app opens the link in its own browser.
      const mailApp = await openElsewhere(browser, link, device);
      await expect(mailApp.getByRole("heading", { name: "Email verified successfully." })).toBeVisible();
      await mailApp.getByRole("button", { name: "Continue to Zest Snap" }).click();
      await expect(mailApp).toHaveURL(/\/app/);
      // Back in the original browser/app, signing in now works.
      await page.getByRole("button", { name: "Already verified? Sign in" }).click();
      await page.getByPlaceholder("you@example.com").fill(email);
      await page.getByPlaceholder("At least 8 characters").fill(PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page).toHaveURL(/\/app/);
    } finally {
      await browser.close();
    }
  });
}
