import { test } from "node:test";
import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
// @ts-expect-error -- plain ESM script without type declarations
import { AscKeyError, nextBuildNumber, normalizeAscPrivateKey, pickGroups, repoBuildNumber, token } from "../scripts/ios/asc.mjs";

test("build numbers always move past every build App Store Connect has seen", () => {
  assert.equal(nextBuildNumber(8, []), 8);
  assert.equal(nextBuildNumber(8, ["7"]), 8);
  assert.equal(nextBuildNumber(8, ["8"]), 9);
  assert.equal(nextBuildNumber(8, ["9", "12", "10"]), 13, "numeric, not lexical");
  assert.equal(nextBuildNumber(8, ["1.0.3", "abc", "11"]), 12, "ignores non-integer versions");
});

test("only internal TestFlight groups receive CI builds", () => {
  const g = (name: string, isInternalGroup: boolean) => ({ id: name, attributes: { name, isInternalGroup } });
  const groups = [g("Team", true), g("QA", true), g("Public beta", false)];
  assert.deepEqual(pickGroups(groups).map((x: { id: string }) => x.id), ["Team", "QA"]);
  assert.deepEqual(pickGroups(groups, "QA").map((x: { id: string }) => x.id), ["QA"]);
  assert.throws(() => pickGroups(groups, "Public beta"), /No internal TestFlight group named: Public beta/);
});

test("the Xcode project has one build number for the workflow to start from", () => {
  assert.ok(repoBuildNumber() >= 8);
  assert.throws(() => repoBuildNumber("CURRENT_PROJECT_VERSION = 7;\nCURRENT_PROJECT_VERSION = 8;"), /Expected one/);
});

test("App Store Connect tokens are valid ES256 JWTs that expire within 20 minutes", () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwt = token({ keyId: "KEY123", issuerId: "issuer", privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }), now: 1000 });
  const [h, p, s] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url").toString()), { alg: "ES256", kid: "KEY123", typ: "JWT" });
  const payload = JSON.parse(Buffer.from(p, "base64url").toString());
  assert.equal(payload.aud, "appstoreconnect-v1");
  assert.ok(payload.exp - payload.iat <= 20 * 60);
  assert.ok(verify("sha256", Buffer.from(`${h}.${p}`), { key: createPublicKey(privateKey), dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url")));
});

test("TestFlight uploads only run on demand, from main, after CI, with environment approval", () => {
  const wf = readFileSync(".github/workflows/ios-testflight.yml", "utf8");
  const on = wf.slice(wf.indexOf("\non:"), wf.indexOf("\npermissions:"));
  assert.doesNotMatch(on, /pull_request|branches:/, "must not upload every development commit");
  assert.match(on, /workflow_dispatch/);
  assert.match(wf, /merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/);
  assert.match(wf, /uses: \.\/\.github\/workflows\/ci\.yml/);
  assert.match(wf, /needs: tests\n\s+runs-on: macos/);
  assert.match(wf, /environment: testflight/);
  assert.match(readFileSync(".github/workflows/ci.yml", "utf8"), /workflow_call:/);
  // Credentials only ever come from secrets and are written to a private temp file.
  assert.doesNotMatch(wf, /echo "\$ASC_PRIVATE_KEY"|cat .*AuthKey/);
  assert.match(wf, /umask 077/);
});

// ---- App Store Connect private key (ASC_PRIVATE_KEY). Every key here is disposable, generated per run. ----

const p8 = (type: "ec" | "rsa" = "ec", namedCurve = "prime256v1") =>
  (type === "ec"
    ? generateKeyPairSync("ec", { namedCurve })
    : generateKeyPairSync("rsa", { modulusLength: 2048 })
  ).privateKey.export({ format: "pem", type: "pkcs8" }) as string;
const bodyOf = (pem: string) => pem.split("\n").filter((l) => l && !l.startsWith("-----")).join("");
/** No 12-character run of the key body may appear in a message. */
const leaks = (message: string, pem: string) => {
  const body = bodyOf(pem);
  for (let i = 0; i + 12 <= body.length; i += 6) if (message.includes(body.slice(i, i + 12))) return true;
  return false;
};

test("the TestFlight failure: an escaped one-line secret is exactly what OpenSSL rejects as DECODER unsupported", () => {
  const pem = p8();
  assert.throws(() => createPrivateKey(pem.trim().replace(/\n/g, "\\n")), /1E08010C:DECODER routines::unsupported/);
  assert.equal(normalizeAscPrivateKey(pem.trim().replace(/\n/g, "\\n")).pem, pem);
});

test("ASC private keys are accepted as downloaded or in unambiguous equivalent layouts, always as the canonical .p8", () => {
  const pem = p8();
  const variants: Record<string, string> = {
    "as downloaded": pem,
    "CRLF line endings": pem.replace(/\n/g, "\r\n"),
    "surrounding blank lines and spaces": `\n\n  ${pem}  \n\n`,
    "indented lines (pasted into YAML)": pem.split("\n").map((l) => (l ? "    " + l : l)).join("\n"),
    "UTF-8 byte order mark": "\uFEFF" + pem,
    "body on one line": `-----BEGIN PRIVATE KEY-----\n${bodyOf(pem)}\n-----END PRIVATE KEY-----`,
    "literal \\n escapes": pem.trim().replace(/\n/g, "\\n"),
    "literal \\r\\n escapes": pem.trim().replace(/\n/g, "\\r\\n"),
    "literal \\n escapes with a trailing escape": pem.replace(/\n/g, "\\n"),
  };
  for (const [name, raw] of Object.entries(variants)) {
    const { pem: out, key } = normalizeAscPrivateKey(raw);
    assert.equal(out, pem, name);
    assert.equal(key.asymmetricKeyType, "ec", name);
    assert.ok(out.split("\n").every((l: string) => l.length <= 64), name);
  }
});

test("malformed or unrelated ASC keys are rejected with a clear message that contains no key material", () => {
  const pem = p8();
  const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const body = bodyOf(pem);
  const cases: [string, string, RegExp][] = [
    ["empty", "   \n ", /is empty/],
    ["double quoted (JSON)", JSON.stringify(pem), /wrapped in quotes/],
    ["single quoted", `'${pem.trim()}'`, /wrapped in quotes/],
    ["body without header", body, /does not start with -----BEGIN PRIVATE KEY-----/],
    ["base64 of the whole file", Buffer.from(pem).toString("base64"), /base64-encoded/],
    ["spaces instead of line breaks", pem.trim().replace(/\n/g, " "), /spaces where its line breaks should be/],
    ["real and escaped line breaks mixed", pem.replace("\n", "\\n"), /mixes real line breaks/],
    ["missing footer", pem.trim().split("\n").slice(0, -1).join("\n"), /does not end with -----END PRIVATE KEY-----/],
    ["two keys", pem + pem, /more than one PEM block/],
    ["damaged body", pem.replace(body.slice(10, 20), "!!!!!!!!!!"), /damaged key body/],
    ["truncated body", `-----BEGIN PRIVATE KEY-----\n${body.slice(0, 40)}\n-----END PRIVATE KEY-----\n`, /could not be read|damaged key body/],
    ["SEC1 EC key", ec.privateKey.export({ format: "pem", type: "sec1" }) as string, /"EC PRIVATE KEY" PEM block/],
    ["encrypted key", ec.privateKey.export({ format: "pem", type: "pkcs8", cipher: "aes-256-cbc", passphrase: "test" }) as string, /"ENCRYPTED PRIVATE KEY" PEM block/],
    ["public key", ec.publicKey.export({ format: "pem", type: "spki" }) as string, /"PUBLIC KEY" PEM block/],
    ["RSA key", p8("rsa"), /is a RSA key; App Store Connect API keys are EC P-256/],
    ["P-384 key", p8("ec", "secp384r1"), /is an EC secp384r1 key/],
  ];
  for (const [name, raw, expected] of cases) {
    let error: unknown;
    try {
      normalizeAscPrivateKey(raw);
    } catch (e) {
      error = e;
    }
    assert.ok(error instanceof AscKeyError, `${name}: expected AscKeyError, got ${error}`);
    const message = (error as Error).message;
    assert.match(message, expected, name);
    assert.match(message, /AuthKey_<KEY_ID>\.p8/, name);
    assert.ok(!leaks(message, raw.includes("PRIVATE KEY") ? raw : pem), `${name}: message contains key material`);
    assert.doesNotMatch(message, /DECODER|1E08010C/, name);
  }
});

test("tokens are signed with the validated key and verify against its public key", () => {
  const pem = p8();
  const { key } = normalizeAscPrivateKey(pem.trim().replace(/\n/g, "\\n"));
  const jwt = token({ keyId: "KEY123", issuerId: "issuer", privateKey: key, now: 1000 });
  const [h, p, s] = jwt.split(".");
  const payload = JSON.parse(Buffer.from(p, "base64url").toString());
  assert.deepEqual(payload, { iss: "issuer", iat: 1000, exp: 1900, aud: "appstoreconnect-v1" });
  assert.equal(Buffer.from(s, "base64url").length, 64, "ES256 signature is raw r||s (IEEE P1363), as JWS requires");
  assert.ok(verify("sha256", Buffer.from(`${h}.${p}`), { key: createPublicKey(createPrivateKey(pem)), dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url")));
  assert.throws(() => token({ keyId: "K", issuerId: "i", privateKeyPem: JSON.stringify(pem) }), AscKeyError);
});

const asc = (args: string[], env: Record<string, string>) =>
  spawnSync(process.execPath, ["scripts/ios/asc.mjs", ...args], { env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" as const, ...env }, encoding: "utf8" });

test("install-key writes a validated .p8 with mode 600 and never prints the key", () => {
  const dir = mkdtempSync(join(tmpdir(), "asc-key-"));
  try {
    const pem = p8();
    const out = join(dir, "AuthKey.p8");
    const ok = asc(["install-key", out], { ASC_PRIVATE_KEY: pem.trim().replace(/\n/g, "\\n") });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(readFileSync(out, "utf8"), pem);
    assert.equal(statSync(out).mode & 0o777, 0o600);
    assert.ok(!leaks(ok.stdout + ok.stderr, pem));

    const badPath = join(dir, "Bad.p8");
    const bad = asc(["install-key", badPath], { ASC_PRIVATE_KEY: bodyOf(pem) });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /::error::ASC_PRIVATE_KEY does not start with -----BEGIN PRIVATE KEY-----/);
    assert.ok(!existsSync(badPath), "nothing is written for a malformed key");
    assert.ok(!leaks(bad.stdout + bad.stderr, pem));

    const missing = asc(["install-key", badPath], {});
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /ASC_PRIVATE_KEY is empty/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check fails on a malformed key file before contacting App Store Connect", () => {
  const dir = mkdtempSync(join(tmpdir(), "asc-key-"));
  try {
    const pem = p8();
    const file = join(dir, "AuthKey.p8");
    writeFileSync(file, JSON.stringify(pem), { mode: 0o600 });
    // An unroutable proxy would make any request hang or fail differently; the key error must come first.
    const res = asc(["check"], { ASC_KEY_ID: "KEY123", ASC_ISSUER_ID: "issuer", ASC_APP_ID: "1", ASC_KEY_PATH: file, HTTPS_PROXY: "http://127.0.0.1:9" });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /::error::ASC_PRIVATE_KEY is wrapped in quotes/);
    assert.ok(!leaks(res.stdout + res.stderr, pem));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the workflow installs the key through the validator, not by writing the raw secret", () => {
  const wf = readFileSync(".github/workflows/ios-testflight.yml", "utf8");
  assert.match(wf, /node scripts\/ios\/asc\.mjs install-key "\$RUNNER_TEMP\/AuthKey\.p8"/);
  assert.doesNotMatch(wf, /printf[^\n]*\$ASC_PRIVATE_KEY|>\s*"\$RUNNER_TEMP\/AuthKey\.p8"/);
  const install = wf.indexOf("install-key"), check = wf.indexOf("asc.mjs check");
  assert.ok(install > 0 && install < check, "the key is validated before the first App Store Connect call");
});
