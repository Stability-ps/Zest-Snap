#!/usr/bin/env node
/**
 * Production Supabase Auth settings for Zest Snap (Site URL, redirect allowlist, email templates).
 * Dry run by default: prints the differences. Apply with --apply.
 *
 *   SUPABASE_ACCESS_TOKEN=… node scripts/supabase-auth-config.mjs [--apply]
 *
 * Templates live in supabase/templates and use token_hash links ({{ .SiteURL }}/auth/confirm), which work
 * in any browser or app because they don't need the PKCE verifier from the browser that requested them.
 */
import { readFileSync } from "node:fs";

const REF = process.env.SUPABASE_PROJECT_REF || "rnlqsaaoywqrvokoysei";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error("Set SUPABASE_ACCESS_TOKEN (a Supabase personal access token).");
  process.exit(1);
}
const template = (name) => readFileSync(new URL(`../supabase/templates/${name}.html`, import.meta.url), "utf8").trim();

export const desired = {
  site_url: "https://app.zestsnap.app",
  uri_allow_list: [
    "https://app.zestsnap.app/**",
    "https://zestsnap.app/**",
    "https://www.zestsnap.app/**",
    "zestsnap://**",
  ].join(","),
  mailer_subjects_confirmation: "Verify your Zest Snap account",
  mailer_templates_confirmation_content: template("confirmation"),
  mailer_subjects_recovery: "Reset your Zest Snap password",
  mailer_templates_recovery_content: template("recovery"),
  mailer_subjects_email_change: "Confirm your new Zest Snap email address",
  mailer_templates_email_change_content: template("email_change"),
};

const api = `https://api.supabase.com/v1/projects/${REF}/config/auth`;
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const current = await fetch(api, { headers }).then(async (r) => {
  if (!r.ok) throw new Error(`GET auth config failed: ${r.status} ${await r.text()}`);
  return r.json();
});

const changes = Object.fromEntries(Object.entries(desired).filter(([k, v]) => current[k] !== v));
for (const [k, v] of Object.entries(changes)) console.log(`${k}:\n  - ${JSON.stringify(current[k])}\n  + ${JSON.stringify(v)}`);
console.log(
  `\nAlso check: mailer_autoconfirm=${current.mailer_autoconfirm} (want false), mailer_otp_exp=${current.mailer_otp_exp}s, ` +
    `smtp_host=${current.smtp_host || "(Supabase built-in mailer)"}, rate_limit_email_sent=${current.rate_limit_email_sent}/h, smtp_max_frequency=${current.smtp_max_frequency}s`,
);
if (!Object.keys(changes).length) console.log("Auth config already matches.");
else if (!process.argv.includes("--apply")) console.log("\nDry run. Re-run with --apply to update production.");
else {
  const r = await fetch(api, { method: "PATCH", headers, body: JSON.stringify(changes) });
  if (!r.ok) throw new Error(`PATCH auth config failed: ${r.status} ${await r.text()}`);
  console.log(`Updated ${Object.keys(changes).length} auth settings.`);
}
