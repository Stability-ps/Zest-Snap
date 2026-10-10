import { test, expect, type Page } from "@playwright/test";

/**
 * Google / Apple sign-in against a local Supabase stack with both providers switched on (dummy client ids),
 * manual linking enabled and http://localhost:<port>/** + zestsnap://** in the redirect allow-list. The real
 * provider pages can't be completed locally, so requests to Google/Apple are intercepted and inspected;
 * everything up to that hand-off, and every way back, runs for real. Never run against production.
 *   SOCIAL_E2E_SUPABASE_URL=https://127.0.0.1:<port> SOCIAL_E2E_SECRET_KEY=<local secret key>
 *   TEST_BASE_URL=http://localhost:3101 npx playwright test social-auth-account
 */
const SUPABASE = process.env.SOCIAL_E2E_SUPABASE_URL || "";
const SECRET = process.env.SOCIAL_E2E_SECRET_KEY || "";
test.skip(!SUPABASE || !SECRET || /supabase\.co/.test(SUPABASE), "needs a local Supabase stack");
test.use({ ignoreHTTPSErrors: true, serviceWorkers: "block" });

const PASSWORD = "Social-Test-2026!";
async function admin(path: string, init: { method?: string; body?: string } = {}) {
  const { request } = await import("node:https");
  return new Promise<{ status: number; json: any }>((resolve, reject) => {
    const req = request(new URL(path, SUPABASE), {
      method: init.method || "GET", rejectUnauthorized: false,
      headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json", Prefer: "return=representation" },
    }, (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => resolve({ status: res.statusCode || 0, json: b ? JSON.parse(b) : null })); });
    req.on("error", reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}
async function newUser(email: string, metadata: Record<string, unknown> = {}, keepOnboarding = false) {
  const r = await admin("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password: PASSWORD, email_confirm: true, user_metadata: metadata }) });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  if (!keepOnboarding) await admin(`/rest/v1/premium_onboarding?user_id=eq.${r.json.id}`, { method: "DELETE" }).catch(() => undefined);
  return r.json.id as string;
}
async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /^Sign in/ }).click();
  await page.waitForURL((u) => u.pathname === "/app");
}
/**
 * Captures where Supabase sends the browser (Google/Apple) instead of leaving for the provider. Redirect
 * targets can't be routed, so the Supabase authorize request is fetched without following its redirect.
 */
async function captureProvider(page: Page, host: RegExp): Promise<{ url: Promise<URL> }> {
  let resolve!: (u: URL) => void;
  const captured = new Promise<URL>((r) => (resolve = r));
  await page.context().route(/\/auth\/v1\/(authorize|user\/identities\/authorize)/, async (route) => {
    const res = await route.fetch({ maxRedirects: 0 });
    const location = res.headers()["location"] || "";
    if (host.test(location)) {
      resolve(new URL(location));
      return route.fulfill({ status: 200, contentType: "text/html", body: "<p>provider</p>" });
    }
    return route.fulfill({ response: res });
  });
  // Wrapped: an async function returning a bare promise would make the caller wait for the capture itself.
  return { url: captured };
}

test("login and signup offer Google then Apple on the web, with the email form below; not on password reset", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  const buttons = page.locator(".socialAuth .socialButton");
  await expect(buttons).toHaveText(["Continue with Google", "Continue with Apple"]);
  for (const b of await buttons.all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.getByRole("button", { name: "Don’t have an account? Create account" }).click();
  await expect(page.getByRole("heading", { name: "Create your Zest account" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await page.getByRole("button", { name: "Already have an account? Sign in" }).click();
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
});

test("Continue with Google: PKCE, account chooser, no extra scopes, and the right way back", async ({ page }) => {
  let authorize: URL | null = null;
  page.on("request", (r) => { if (r.url().includes("/auth/v1/authorize")) authorize = new URL(r.url()); });
  await page.goto("/login?next=%2Fapp%3Fview%3Dplanner");
  const google = await captureProvider(page, /accounts\.google\.com/);
  await page.getByRole("button", { name: "Continue with Google" }).click();
  const g = await google.url;
  expect(authorize).not.toBeNull();
  const a = authorize as unknown as URL;
  expect(a.searchParams.get("provider")).toBe("google");
  expect(a.searchParams.get("code_challenge")).toMatch(/^[\w-]{43,128}$/);
  expect(a.searchParams.get("code_challenge_method")).toMatch(/s256/i);
  expect(a.searchParams.get("redirect_to")).toBe("http://localhost:3101/auth/callback?provider=google&next=%2Fapp%3Fview%3Dplanner");
  expect(g.searchParams.get("client_id")).toBe("local-test-google-client");
  expect(g.searchParams.get("prompt")).toBe("select_account");
  expect(g.searchParams.get("state")).toBeTruthy();
  const scopes = (g.searchParams.get("scope") || "").split(/[ +]/);
  expect(scopes.every((s) => /^(email|profile|openid|https:\/\/www\.googleapis\.com\/auth\/userinfo\.(email|profile))$/.test(s))).toBe(true);
  expect(scopes.join(" ")).not.toMatch(/calendar/);
});

test("Continue with Apple: hands off to Apple with name and email only", async ({ page }) => {
  await page.goto("/login");
  const apple = await captureProvider(page, /appleid\.apple\.com/);
  await page.getByRole("button", { name: "Continue with Apple" }).click();
  const a = await apple.url;
  expect(a.searchParams.get("client_id")).toBe("app.zestsnap.local-test");
  expect((a.searchParams.get("scope") || "").split(/[ +]/).sort()).toEqual(["email", "name"]);
  expect(a.searchParams.get("state")).toBeTruthy();
});

test("cancelled, expired and invalid returns land on sign-in with a plain message", async ({ page }) => {
  await page.goto("/auth/callback?provider=google&error=access_denied&error_description=The+user+denied+access");
  await expect(page).toHaveURL(/\/login\?auth_error=cancelled/);
  await expect(page.getByRole("status")).toHaveText("Sign-in was cancelled. You can try again anytime.");
  // A code without this browser's PKCE verifier (forged, replayed or from another browser) is refused.
  await page.goto("/auth/callback?provider=apple&code=00000000-0000-0000-0000-000000000000");
  await expect(page).toHaveURL(/\/login\?auth_error=expired/);
  await expect(page.getByRole("status")).toHaveText("Your session has expired. Please sign in again.");
  await page.goto("/auth/callback?provider=google");
  await expect(page).toHaveURL(/\/login\?auth_error=expired/);
  // Nothing internal is ever shown.
  await expect(page.locator("body")).not.toContainText(/flow_state|verifier|token|exception/i);
});

test("completion finishes like an email sign-in: device registered, relay address never shown as a name, back to the page", async ({ page }) => {
  const relay = `r${Date.now().toString(36)}@privaterelay.appleid.com`;
  const id = await newUser(relay);
  expect((await admin(`/rest/v1/profiles?id=eq.${id}&select=display_name`)).json[0].display_name).toBe(relay.split("@")[0]);
  await signIn(page, relay);
  await page.goto("/auth/social-complete?next=%2Fapp%3Fview%3Dplanner");
  await page.waitForURL(/\/app\?view=planner/);
  expect((await admin(`/rest/v1/profiles?id=eq.${id}&select=display_name`)).json[0].display_name).toBe("");
  expect((await admin(`/rest/v1/device_accounts?user_id=eq.${id}&select=user_id`)).json.length).toBe(1);
  // A chosen name is kept on later sign-ins.
  await admin(`/rest/v1/profiles?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ display_name: "Thandi" }) });
  await page.goto("/auth/social-complete?next=%2Fapp");
  await page.waitForURL((u) => u.pathname === "/app");
  expect((await admin(`/rest/v1/profiles?id=eq.${id}&select=display_name`)).json[0].display_name).toBe("Thandi");
  // Signed out, the completion page never pretends: it asks to sign in again.
  await page.context().clearCookies();
  await page.goto("/auth/social-complete");
  await expect(page.locator(".authIntro")).toHaveText("Your session has expired. Please sign in again.");
});

test("connecting Google from Settings starts from the signed-in account; a conflict is explained", async ({ page }) => {
  const email = `link-${Date.now().toString(36)}@example.com`;
  await newUser(email);
  await signIn(page, email);
  await page.goto("/settings?sheet=account");
  await expect(page.getByRole("heading", { name: "Sign-in methods" })).toBeVisible();
  await expect(page.getByText("Email and password")).toBeVisible();
  let linkRequest: string | null = null;
  page.on("request", (r) => { if (r.url().includes("/user/identities/authorize")) linkRequest = r.url(); });
  // Linking returns the provider URL as JSON and navigates there directly, so Google itself is intercepted.
  let provider: URL | null = null;
  await page.context().route(/accounts\.google\.com/, (route) => {
    provider = new URL(route.request().url());
    return route.fulfill({ status: 200, contentType: "text/html", body: "<p>provider</p>" });
  });
  await page.getByRole("button", { name: "Connect Google", exact: true }).click();
  await expect.poll(() => provider?.searchParams.get("client_id")).toBe("local-test-google-client");
  expect(linkRequest).toContain("provider=google");
  expect(linkRequest).toContain(encodeURIComponent("link=1"));
  // Google account already belongs to someone else: the callback reports it and nothing is merged.
  await page.goto("/auth/callback?provider=google&link=1&error=server_error&error_code=identity_already_exists&error_description=Identity+is+already+linked+to+another+user");
  await expect(page).toHaveURL(/\/settings\?sheet=account&auth_error=conflict/);
  await expect(page.locator(".settingsSaved")).toHaveText("This sign-in method is already connected to another account.");
});

test("a brand-new account finishing Google/Apple sign-in sees the premium introduction once", async ({ page }) => {
  const email = `new-social-${Date.now().toString(36)}@example.com`;
  await newUser(email, { full_name: "New Person" }, true);
  await page.goto("/login");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /^Sign in/ }).click();
  // New account: first choose the look (Light is preselected), then the one-time premium screen.
  await page.waitForURL(/\/welcome\?next=/);
  await expect(page.getByRole("heading", { name: "How should Zest look?" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Light/ })).toBeChecked();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/\/upgrade\?from=onboarding/);
  await page.getByRole("button", { name: "Continue with Free plan" }).click();
  await page.waitForURL((u) => u.pathname === "/app");
  await page.goto("/auth/social-complete?next=%2Fapp");
  await page.waitForURL((u) => u.pathname === "/app");
});
