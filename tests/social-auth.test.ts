import { test } from "node:test";
import assert from "node:assert/strict";
import {
  enabledProviders,
  fetchEnabledProviders,
  isAppleRelayEmail,
  isOAuthSession,
  oauthErrorFromParams,
  oauthErrorKind,
  oauthErrorMessage,
  oauthRedirect,
  providerOrder,
  socialDisplayName,
} from "../lib/social-auth";
import { safeAuthNext } from "../lib/auth";
import { inAppPath, needsFullNavigation } from "../lib/native/deep-links";

test("only providers switched on in Supabase are offered, Apple first on iOS and Google first elsewhere", async () => {
  assert.deepEqual(enabledProviders({ external: { email: true, google: true, apple: false } }), ["google"]);
  assert.deepEqual(enabledProviders({ external: { google: "true" } }), [], "only real booleans count");
  assert.deepEqual(enabledProviders(null), []);
  assert.deepEqual(providerOrder("ios", ["google", "apple"]), ["apple", "google"]);
  assert.deepEqual(providerOrder("android", ["google", "apple"]), ["google", "apple"]);
  assert.deepEqual(providerOrder("web", ["apple"]), ["apple"]);
  const ok = (async () => new Response(JSON.stringify({ external: { google: true, apple: true } }))) as typeof fetch;
  assert.deepEqual(await fetchEnabledProviders("https://x.supabase.co/", "k", ok), ["google", "apple"]);
  const down = (async () => { throw new Error("offline"); }) as typeof fetch;
  assert.deepEqual(await fetchEnabledProviders("https://x.supabase.co", "k", down), [], "an outage hides the buttons instead of breaking sign-in");
});

test("return addresses: web callback, native custom scheme, and linking", () => {
  assert.equal(oauthRedirect({ origin: "https://app.zestsnap.app", provider: "google", next: "/app", native: false }),
    "https://app.zestsnap.app/auth/callback?provider=google&next=%2Fapp");
  const native = oauthRedirect({ origin: "https://app.zestsnap.app", provider: "apple", next: "/app?view=planner", native: true });
  assert.equal(native, "zestsnap://auth/callback?provider=apple&next=%2Fapp%3Fview%3Dplanner");
  // The native bridge turns it back into the server callback inside the WebView that holds the PKCE verifier.
  const path = inAppPath(native + "&code=abc");
  assert.equal(path, "/auth/callback?provider=apple&next=%2Fapp%3Fview%3Dplanner&code=abc");
  assert.equal(needsFullNavigation(path!), true);
  assert.match(oauthRedirect({ origin: "https://app.zestsnap.app", provider: "google", next: "/settings", native: false, link: true }), /link=1/);
  assert.equal(inAppPath("zestsnap://evil.example/steal"), null);
});

test("provider errors become plain messages; cancellation, conflicts, expired or invalid state, outages", () => {
  assert.equal(oauthErrorKind("access_denied", "The user denied the request"), "cancelled");
  assert.equal(oauthErrorKind(null, "user cancelled"), "cancelled");
  assert.equal(oauthErrorKind("identity_already_exists", "Identity is already linked to another user"), "conflict");
  assert.equal(oauthErrorKind("flow_state_not_found", "invalid flow state, no valid flow state found"), "expired");
  assert.equal(oauthErrorKind("bad_code_verifier", null), "expired");
  assert.equal(oauthErrorKind("session_expired", null), "expired");
  assert.equal(oauthErrorKind(null, "Failed to fetch"), "network");
  assert.equal(oauthErrorKind("provider_disabled", "Unsupported provider: provider is not enabled"), "unavailable");
  assert.equal(oauthErrorFromParams(new URLSearchParams("error=access_denied&error_description=denied")), "cancelled");
  assert.equal(oauthErrorFromParams(new URLSearchParams("code=x")), null);
  assert.equal(oauthErrorMessage.cancelled, "Sign-in was cancelled. You can try again anytime.");
  for (const m of Object.values(oauthErrorMessage)) assert.doesNotMatch(m, /token|secret|exception|stack/i);
});

test("a session from Google/Apple is recognised from the token, not from the URL", () => {
  assert.equal(isOAuthSession(["oauth"]), true);
  assert.equal(isOAuthSession(["password"]), false);
  assert.equal(isOAuthSession(["otp"]), false);
});

test("Apple names: kept from the first authorization; a chosen name is never replaced; a relay-address placeholder is cleared", () => {
  const relay = "x7k2pq9r@privaterelay.appleid.com";
  assert.equal(isAppleRelayEmail(relay), true);
  // First Apple sign-in: trigger stored the relay local part; Apple sent the name → use it.
  assert.equal(socialDisplayName("x7k2pq9r", relay, { full_name: "Thandi Nkosi" }), "Thandi Nkosi");
  // Later sign-ins: Apple sends no name → keep what is there.
  assert.equal(socialDisplayName("Thandi Nkosi", relay, {}), null);
  // A relay address is never shown as someone's name.
  assert.equal(socialDisplayName("x7k2pq9r", relay, {}), "");
  // Google: given/family names; a name the person chose is never replaced.
  assert.equal(socialDisplayName("sam", "sam@gmail.com", { given_name: "Sam", family_name: "Lee" }), "Sam Lee");
  assert.equal(socialDisplayName("Sammy", "sam@gmail.com", { full_name: "Samuel Lee" }), null);
  assert.equal(socialDisplayName("", "a@b.co", {}), null, "nothing to set: leave it");
});

test("returns after sign-in can't be redirected off-site", () => {
  for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "/unknown-page"])
    assert.equal(safeAuthNext(bad), "/app", bad);
  assert.equal(safeAuthNext("/settings"), "/settings");
  assert.equal(safeAuthNext("/app?view=planner"), "/app?view=planner");
});
