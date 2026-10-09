import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import {
  authLinkDestination,
  authLinkErrorFrom,
  authLinkErrorStatus,
  emailLinkType,
  isExistingAccountSignup,
  recordResend,
  resendWaitSeconds,
  RESEND_COOLDOWN_SECONDS,
  sessionMethods,
} from "../lib/auth";
import { inAppPath, needsFullNavigation } from "../lib/native/deep-links";
import { proxy } from "../proxy";

const jwt = (payload: object) => ["e30", Buffer.from(JSON.stringify(payload)).toString("base64url"), "sig"].join(".");

test("used, expired and malformed email links map to distinct result screens", () => {
  assert.equal(authLinkErrorStatus("otp_expired", "Email link is invalid or has expired"), "expired");
  assert.equal(authLinkErrorStatus(undefined, "Token has expired or is invalid"), "expired");
  assert.equal(authLinkErrorStatus("flow_state_not_found"), "unfinished");
  assert.equal(authLinkErrorStatus("bad_code_verifier"), "unfinished");
  assert.equal(authLinkErrorStatus("validation_failed"), "invalid");
  assert.equal(authLinkErrorStatus(null, null), "invalid");
  assert.equal(authLinkErrorFrom(new URLSearchParams("error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired")), "expired");
  assert.equal(authLinkErrorFrom(new URLSearchParams("code=abc")), null);
});

test("only known email link types are accepted", () => {
  for (const t of ["signup", "email", "recovery", "email_change"]) assert.equal(emailLinkType(t), t);
  for (const t of [null, "", "sms", "phone_change", "<script>"]) assert.equal(emailLinkType(t), null);
});

test("recovery links always open the reset screen, never the homepage or the app", () => {
  assert.equal(authLinkDestination({ type: "recovery" }), "/reset-password");
  assert.equal(authLinkDestination({ methods: ["recovery"] }), "/reset-password");
  assert.equal(authLinkDestination({ type: "email" }), "/auth/confirmed?status=verified");
  assert.equal(authLinkDestination({ type: "signup" }), "/auth/confirmed?status=verified");
  assert.equal(authLinkDestination({ methods: ["email/signup"] }), "/auth/confirmed?status=verified");
  assert.equal(authLinkDestination({ type: "email_change" }), "/auth/confirmed?status=email-changed");
});

test("session methods are read from the access token's amr claim", () => {
  assert.deepEqual(sessionMethods(jwt({ amr: [{ method: "recovery", timestamp: 1 }] })), ["recovery"]);
  assert.deepEqual(sessionMethods(jwt({ amr: [{ method: "email/signup" }, { method: "password" }] })), ["email/signup", "password"]);
  assert.deepEqual(sessionMethods("not-a-jwt"), []);
  assert.deepEqual(sessionMethods(undefined), []);
});

test("resend verification is rate limited per address for 60 seconds", () => {
  const data = new Map<string, string>();
  const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  const t0 = 1_000_000;
  assert.equal(resendWaitSeconds(store, "a@x.com", t0), 0);
  recordResend(store, "A@X.com ", t0);
  assert.equal(resendWaitSeconds(store, "a@x.com", t0), RESEND_COOLDOWN_SECONDS);
  assert.equal(resendWaitSeconds(store, "a@x.com", t0 + 59_500), 1);
  assert.equal(resendWaitSeconds(store, "a@x.com", t0 + 60_000), 0);
  assert.equal(resendWaitSeconds(store, "b@x.com", t0), 0, "other addresses are not blocked");
  store.setItem("zest-auth-resend-v1", "garbage");
  assert.equal(resendWaitSeconds(store, "a@x.com", t0), 0);
});

test("signing up with an existing verified address is detected", () => {
  assert.equal(isExistingAccountSignup({ identities: [] }), true);
  assert.equal(isExistingAccountSignup({ identities: [{ provider: "email" }] }), false);
  assert.equal(isExistingAccountSignup(null), false);
  assert.equal(isExistingAccountSignup({}), false);
});

test("native apps open verification links in-app with a full page load", () => {
  const confirm = "https://app.zestsnap.app/auth/confirm?token_hash=pkce_abc&type=email";
  assert.equal(inAppPath(confirm), "/auth/confirm?token_hash=pkce_abc&type=email");
  assert.equal(inAppPath("https://app.zestsnap.app/auth/confirmed?status=verified"), "/auth/confirmed?status=verified");
  assert.equal(inAppPath("https://app.zestsnap.app/auth/other"), null);
  assert.equal(needsFullNavigation("/auth/confirm?token_hash=x&type=recovery"), true);
  assert.equal(needsFullNavigation("/auth/callback?code=x"), true);
  const manifest = readFileSync("android/app/src/main/AndroidManifest.xml", "utf8");
  assert.match(manifest, /android:pathPrefix="\/auth\/confirm"/);
  const aasa = readFileSync("app/.well-known/apple-app-site-association/route.ts", "utf8");
  assert.match(aasa, /"\/auth\/confirm\*"/);
});

test("email templates use token_hash links that work in any browser or app", () => {
  for (const [name, type] of [["confirmation", "email"], ["recovery", "recovery"], ["email_change", "email_change"]]) {
    const html = readFileSync(`supabase/templates/${name}.html`, "utf8");
    assert.ok(html.includes(`{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=${type}`), name);
    assert.ok(!html.includes("ConfirmationURL"), `${name} must not use the PKCE ConfirmationURL`);
  }
});

const hit = (url: string) => proxy(new NextRequest(url, { headers: { host: new URL(url).host } }));

test("auth redirects that fall back to the Site URL go to the auth screens, not the homepage", async () => {
  for (const [from, to] of [
    ["https://zestsnap.app/?code=abc", "https://app.zestsnap.app/auth/callback?code=abc"],
    ["https://app.zestsnap.app/?code=abc", "https://app.zestsnap.app/auth/callback?code=abc"],
    ["https://zestsnap.app/?token_hash=h&type=recovery", "https://app.zestsnap.app/auth/confirm?token_hash=h&type=recovery"],
    ["https://zestsnap.app/?error=access_denied&error_code=otp_expired", "https://app.zestsnap.app/auth/callback?error=access_denied&error_code=otp_expired"],
    ["https://zestsnap.app/auth/confirm?token_hash=h&type=email", "https://app.zestsnap.app/auth/confirm?token_hash=h&type=email"],
    ["https://www.zestsnap.app/auth/callback?code=c", "https://app.zestsnap.app/auth/callback?code=c"],
  ]) {
    const res = await hit(from);
    assert.equal(res.headers.get("location"), to, from);
  }
  // Plain homepage and app visits are unchanged.
  assert.equal((await hit("https://app.zestsnap.app/")).headers.get("location"), "https://app.zestsnap.app/app");
  assert.equal((await hit("https://zestsnap.app/?ref=abc123")).headers.get("location"), null);
});
