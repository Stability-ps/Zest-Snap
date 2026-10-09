// App Store Connect API helper for the iOS TestFlight workflow (.github/workflows/ios-testflight.yml).
// No dependencies: the API token is an ES256 JWT signed with node:crypto.
//
//   node scripts/ios/asc.mjs check                         → verifies the key, the app and the TestFlight groups
//   node scripts/ios/asc.mjs next-build                    → prints the next safe CFBundleVersion
//   node scripts/ios/asc.mjs distribute <build> <version>  → waits for processing, adds the build to internal groups
//
// Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH (path to the .p8 file — never its contents), ASC_APP_ID,
// optional TESTFLIGHT_GROUPS (comma-separated internal group names; default: every internal group),
// optional WHAT_TO_TEST. The key is never printed.
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync, appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const API = "https://api.appstoreconnect.apple.com/v1";
export const BUNDLE_ID = "app.zestsnap";

export function token({ keyId, issuerId, privateKeyPem, now = Math.floor(Date.now() / 1000) }) {
  const b64 = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
  const input = `${b64({ alg: "ES256", kid: keyId, typ: "JWT" })}.${b64({ iss: issuerId, iat: now, exp: now + 15 * 60, aud: "appstoreconnect-v1" })}`;
  const signature = sign("sha256", Buffer.from(input), { key: createPrivateKey(privateKeyPem), dsaEncoding: "ieee-p1363" });
  return `${input}.${signature.toString("base64url")}`;
}

/** Next CFBundleVersion: above every build App Store Connect has seen (any version train) and never below the repo's. */
export function nextBuildNumber(repoBuild, uploadedVersions) {
  const uploaded = uploadedVersions.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0);
  const next = Math.max(repoBuild, uploaded.length ? Math.max(...uploaded) + 1 : 1);
  if (!Number.isInteger(next) || next < 1 || next > 2_100_000_000) throw new Error(`Invalid build number ${next}`);
  return next;
}

/** Internal TestFlight groups to receive the build. Named groups must all exist; external groups are never used. */
export function pickGroups(groups, wanted = "") {
  const internal = groups.filter((g) => g.attributes.isInternalGroup);
  const names = wanted.split(",").map((s) => s.trim()).filter(Boolean);
  if (!names.length) return internal;
  const missing = names.filter((n) => !internal.some((g) => g.attributes.name === n));
  if (missing.length) throw new Error(`No internal TestFlight group named: ${missing.join(", ")} (internal groups: ${internal.map((g) => g.attributes.name).join(", ") || "none"})`);
  return internal.filter((g) => names.includes(g.attributes.name));
}

export function repoBuildNumber(pbxproj = readFileSync("ios/App/App.xcodeproj/project.pbxproj", "utf8")) {
  const values = [...new Set([...pbxproj.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((m) => Number(m[1])))];
  if (values.length !== 1) throw new Error(`Expected one CURRENT_PROJECT_VERSION in the Xcode project, found ${values.join(", ") || "none"}`);
  return values[0];
}

function client() {
  for (const name of ["ASC_KEY_ID", "ASC_ISSUER_ID", "ASC_KEY_PATH", "ASC_APP_ID"]) if (!process.env[name]) throw new Error(`${name} is not set`);
  const privateKeyPem = readFileSync(process.env.ASC_KEY_PATH, "utf8");
  return async function api(path, init = {}) {
    const res = await fetch(path.startsWith("http") ? path : API + path, {
      ...init,
      headers: { Authorization: `Bearer ${token({ keyId: process.env.ASC_KEY_ID, issuerId: process.env.ASC_ISSUER_ID, privateKeyPem })}`, "Content-Type": "application/json", ...init.headers },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const detail = (body.errors ?? []).map((e) => `${e.status} ${e.code}: ${e.detail ?? e.title}`).join("; ") || res.statusText;
      throw new Error(`App Store Connect ${init.method ?? "GET"} ${path.replace(API, "")} failed (${res.status}): ${detail}`);
    }
    return res.status === 204 ? null : res.json();
  };
}

async function all(api, path) {
  const out = [];
  for (let next = path; next; ) {
    const page = await api(next);
    out.push(...page.data);
    next = page.links?.next;
  }
  return out;
}

const appId = () => process.env.ASC_APP_ID;
const summary = (md) => process.env.GITHUB_STEP_SUMMARY && appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function check(api) {
  const app = await api(`/apps/${appId()}?fields[apps]=bundleId,name`);
  if (app.data.attributes.bundleId !== BUNDLE_ID) throw new Error(`ASC_APP_ID ${appId()} is ${app.data.attributes.bundleId}, expected ${BUNDLE_ID}`);
  const groups = await all(api, `/apps/${appId()}/betaGroups?fields[betaGroups]=name,isInternalGroup,hasAccessToAllBuilds&limit=200`);
  const chosen = pickGroups(groups, process.env.TESTFLIGHT_GROUPS);
  console.log(`App: ${app.data.attributes.name} (${BUNDLE_ID})`);
  for (const g of groups) console.log(`Group: ${g.attributes.name} — ${g.attributes.isInternalGroup ? "internal" : "external"}${chosen.includes(g) ? " — receives CI builds" : ""}`);
  if (!chosen.length) throw new Error("No internal TestFlight group exists. Create one in App Store Connect › TestFlight › Internal Testing.");
}

async function nextBuild(api) {
  const builds = await all(api, `/builds?filter[app]=${appId()}&fields[builds]=version&limit=200`);
  console.log(nextBuildNumber(repoBuildNumber(), builds.map((b) => b.attributes.version)));
}

async function distribute(api, buildNumber, version) {
  if (!/^\d+$/.test(buildNumber ?? "") || !/^\d+\.\d+\.\d+$/.test(version ?? "")) throw new Error("Usage: distribute <build> <version>");
  // Uploaded builds take a few minutes to appear and usually 5–30 minutes to process.
  const deadline = Date.now() + 60 * 60 * 1000;
  let build;
  for (;;) {
    const found = await api(`/builds?filter[app]=${appId()}&filter[version]=${buildNumber}&filter[preReleaseVersion.version]=${version}&fields[builds]=processingState,version&limit=1`);
    build = found.data[0];
    const state = build?.attributes.processingState ?? "NOT_YET_VISIBLE";
    console.log(`${new Date().toISOString()} build ${version} (${buildNumber}): ${state}`);
    if (state === "VALID") break;
    if (state === "FAILED" || state === "INVALID") throw new Error(`App Store Connect rejected build ${buildNumber} (${state}). Check the email from App Store Connect for the reason.`);
    if (Date.now() > deadline) throw new Error(`Build ${buildNumber} was still ${state} after 60 minutes`);
    await sleep(30_000);
  }

  if (process.env.WHAT_TO_TEST) {
    // Non-fatal: the build is still distributed without notes.
    try {
      const locs = await api(`/builds/${build.id}/betaBuildLocalizations?fields[betaBuildLocalizations]=locale`);
      const whatsNew = process.env.WHAT_TO_TEST.slice(0, 4000);
      const existing = locs.data.find((l) => l.attributes.locale.startsWith("en")) ?? locs.data[0];
      if (existing) await api(`/betaBuildLocalizations/${existing.id}`, { method: "PATCH", body: JSON.stringify({ data: { type: "betaBuildLocalizations", id: existing.id, attributes: { whatsNew } } }) });
      else await api(`/betaBuildLocalizations`, { method: "POST", body: JSON.stringify({ data: { type: "betaBuildLocalizations", attributes: { locale: "en-US", whatsNew }, relationships: { build: { data: { type: "builds", id: build.id } } } } }) });
    } catch (error) {
      console.warn(`Could not set What to Test: ${error.message}`);
    }
  }

  const groups = pickGroups(await all(api, `/apps/${appId()}/betaGroups?fields[betaGroups]=name,isInternalGroup,hasAccessToAllBuilds&limit=200`), process.env.TESTFLIGHT_GROUPS);
  if (!groups.length) throw new Error("No internal TestFlight group exists. Create one in App Store Connect › TestFlight › Internal Testing.");
  for (const g of groups) {
    if (!g.attributes.hasAccessToAllBuilds)
      await api(`/betaGroups/${g.id}/relationships/builds`, { method: "POST", body: JSON.stringify({ data: [{ type: "builds", id: build.id }] }) });
    console.log(`Available to internal group "${g.attributes.name}"${g.attributes.hasAccessToAllBuilds ? " (automatic distribution)" : ""}`);
  }
  summary(`### ✅ Zest Snap ${version} (${buildNumber}) is on TestFlight\n\nInternal groups: ${groups.map((g) => g.attributes.name).join(", ")}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [command, ...args] = process.argv.slice(2);
  const commands = { check, "next-build": nextBuild, distribute };
  if (!commands[command]) {
    console.error("Usage: node scripts/ios/asc.mjs check | next-build | distribute <build> <version>");
    process.exit(2);
  }
  commands[command](client(), ...args).catch((error) => {
    console.error(`::error::${error.message}`);
    process.exit(1);
  });
}
