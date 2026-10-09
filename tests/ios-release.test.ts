import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { readFileSync } from "node:fs";
// @ts-expect-error -- plain ESM script without type declarations
import { nextBuildNumber, pickGroups, repoBuildNumber, token } from "../scripts/ios/asc.mjs";

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
