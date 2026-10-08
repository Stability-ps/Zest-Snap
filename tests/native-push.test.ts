import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createPublicKey, verify } from "node:crypto";
import {
  apnsPayload, createNativeSender, fcmMessage, fcmTokenIsDead, nativeConfigFromEnv, signJwt,
  type NativeMessage, type NativeToken,
} from "../supabase/functions/_shared/native-push";
import { pushTarget, shouldShowInForeground } from "../lib/native/push";

const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const EC_PEM = ec.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const RSA_PEM = rsa.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const MSG: NativeMessage = { title: "Ana · Family", body: "Who brings snacks?", url: "/shared/p1?tab=messages", tag: "zest-shared-message-p1", channel: "zest-shared" };
const IOS: NativeToken = { id: "t1", platform: "ios", token: "a".repeat(64), environment: "production" };
const ANDROID: NativeToken = { id: "t2", platform: "android", token: "fcm:" + "b".repeat(60), environment: "production" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString());

test("ES256 and RS256 JWTs carry the right claims and verify with the public key", async () => {
  const es = await signJwt("ES256", { kid: "KEY123" }, { iss: "TEAM123", iat: 1 }, EC_PEM);
  const [h, c, s] = es.split(".");
  assert.deepEqual(decode(h), { kid: "KEY123", alg: "ES256", typ: "JWT" });
  assert.deepEqual(decode(c), { iss: "TEAM123", iat: 1 });
  assert.equal(Buffer.from(s, "base64url").length, 64, "ES256 signature must be raw r||s");
  assert.ok(verify("sha256", Buffer.from(`${h}.${c}`), { key: createPublicKey(ec.privateKey), dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url")));

  const rs = await signJwt("RS256", {}, { iss: "svc@x.iam.gserviceaccount.com" }, RSA_PEM.replace(/\n/g, "\\n"));
  const [rh, rc, rsig] = rs.split(".");
  assert.equal(decode(rh).alg, "RS256");
  assert.ok(verify("sha256", Buffer.from(`${rh}.${rc}`), createPublicKey(rsa.privateKey), Buffer.from(rsig, "base64url")));
});

test("credentials come only from complete secrets", () => {
  assert.deepEqual(nativeConfigFromEnv(() => undefined), {});
  const env: Record<string, string> = {
    APNS_KEY_ID: "K", APNS_TEAM_ID: "T", APNS_PRIVATE_KEY: EC_PEM,
    FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: "zest", client_email: "a@b", private_key: RSA_PEM }),
  };
  const cfg = nativeConfigFromEnv((k) => env[k]);
  assert.equal(cfg.apns?.bundleId, "app.zestsnap");
  assert.equal(cfg.fcm?.projectId, "zest");
  assert.equal(nativeConfigFromEnv((k) => (k === "FCM_SERVICE_ACCOUNT_JSON" ? "{oops" : undefined)).fcm, undefined);
});

test("payloads carry the deep link and Android channel", () => {
  assert.deepEqual(apnsPayload(MSG), { aps: { alert: { title: MSG.title, body: MSG.body }, sound: "default", "thread-id": MSG.tag }, url: MSG.url });
  const f = fcmMessage("tok", MSG).message;
  assert.equal(f.token, "tok");
  assert.equal(f.data.url, MSG.url);
  assert.equal(f.android.notification.channel_id, "zest-shared");
});

test("APNs delivery uses the provider token, topic and collapse id, and falls back to the sandbox host", async () => {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string> });
    return url.startsWith("https://api.push.apple.com") ? json(400, { reason: "BadDeviceToken" }) : new Response(null, { status: 200 });
  }) as typeof fetch;
  const sender = createNativeSender({ apns: { keyId: "K", teamId: "T", bundleId: "app.zestsnap", privateKey: EC_PEM } }, fetchImpl);
  assert.deepEqual(await sender.send(IOS, MSG), { ok: true, environment: "sandbox" });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, `https://api.sandbox.push.apple.com/3/device/${IOS.token}`);
  assert.equal(calls[0].headers["apns-topic"], "app.zestsnap");
  assert.equal(calls[0].headers["apns-push-type"], "alert");
  assert.ok(calls[0].headers.authorization.startsWith("bearer ey"));
  assert.equal(calls[0].headers.authorization, calls[1].headers.authorization, "provider token is reused");
});

test("dead tokens are reported so they can be deleted; other failures are retried", async () => {
  const apns = (status: number, reason: string) => createNativeSender(
    { apns: { keyId: "K", teamId: "T", bundleId: "app.zestsnap", privateKey: EC_PEM } },
    (async () => json(status, { reason })) as typeof fetch);
  assert.equal((await apns(410, "Unregistered").send(IOS, MSG)).invalid, true);
  assert.equal((await apns(400, "BadDeviceToken").send(IOS, MSG)).invalid, true);
  assert.equal((await apns(429, "TooManyRequests").send(IOS, MSG)).invalid, false);
  assert.equal(fcmTokenIsDead(404, {}), true);
  assert.equal(fcmTokenIsDead(400, { error: { status: "INVALID_ARGUMENT", details: [{ errorCode: "UNREGISTERED" }] } }), true);
  assert.equal(fcmTokenIsDead(400, { error: { status: "INVALID_ARGUMENT", message: "The registration token is not a valid FCM registration token" } }), true);
  assert.equal(fcmTokenIsDead(400, { error: { status: "INVALID_ARGUMENT", message: "Invalid JSON payload" } }), false);
  assert.equal(fcmTokenIsDead(503, {}), false);
});

test("FCM delivery exchanges a service-account JWT for an access token once and sends HTTP v1 messages", async () => {
  const calls: { url: string; body: string; auth?: string }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: String(init.body), auth: (init.headers as Record<string, string>).authorization });
    if (url === "https://oauth2.googleapis.com/token") return json(200, { access_token: "ya29.token", expires_in: 3600 });
    return json(200, { name: "projects/zest/messages/1" });
  }) as typeof fetch;
  const sender = createNativeSender({ fcm: { projectId: "zest", clientEmail: "svc@zest.iam.gserviceaccount.com", privateKey: RSA_PEM } }, fetchImpl);
  assert.deepEqual(await sender.send(ANDROID, MSG), { ok: true });
  assert.deepEqual(await sender.send(ANDROID, MSG), { ok: true });
  assert.equal(calls.filter((c) => c.url.includes("oauth2")).length, 1, "access token is cached");
  const assertion = new URLSearchParams(calls[0].body).get("assertion")!;
  assert.equal(decode(assertion.split(".")[1]).scope, "https://www.googleapis.com/auth/firebase.messaging");
  assert.equal(calls[1].url, "https://fcm.googleapis.com/v1/projects/zest/messages:send");
  assert.equal(calls[1].auth, "Bearer ya29.token");
  assert.equal(JSON.parse(calls[1].body).message.token, ANDROID.token);
});

test("an unconfigured platform is skipped, not failed silently", async () => {
  const sender = createNativeSender({}, (async () => { throw new Error("must not be called"); }) as typeof fetch);
  assert.deepEqual(await sender.send(IOS, MSG), { ok: false, error: "native_push_unconfigured" });
  assert.deepEqual(await sender.send(ANDROID, MSG), { ok: false, error: "native_push_unconfigured" });
  assert.deepEqual(sender.configured, { ios: false, android: false });
});

test("tapping a push only ever opens a Zest Snap screen", () => {
  assert.equal(pushTarget({ url: "/shared/p1?tab=messages" }), "/shared/p1?tab=messages");
  assert.equal(pushTarget({ url: "/share/0b0c4a5e-1111-4111-8111-111111111111" }), "/share/0b0c4a5e-1111-4111-8111-111111111111");
  assert.equal(pushTarget({ url: "/app?view=calendar&tab=upcoming" }), "/app?view=calendar&tab=upcoming");
  for (const bad of ["https://evil.example/app", "//evil.example/app", "/admin", "javascript:alert(1)", undefined, 42])
    assert.equal(pushTarget({ url: bad }), "/app", String(bad));
  assert.equal(pushTarget(null), "/app");
});

test("Android foreground pushes are skipped only for the screen already open", () => {
  assert.equal(shouldShowInForeground("/shared/p1?tab=messages", "/shared/p1", ""), false);
  assert.equal(shouldShowInForeground("/shared/p1?tab=messages", "/shared/p2", ""), true);
  assert.equal(shouldShowInForeground("/app?view=calendar&tab=upcoming", "/app", "?view=planner"), true);
  assert.equal(shouldShowInForeground("/app?view=calendar&tab=upcoming", "/app", "?view=calendar&tab=upcoming"), false);
});
