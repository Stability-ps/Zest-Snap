// Native push delivery: Apple Push Notification service (iOS) and Firebase Cloud Messaging HTTP v1 (Android).
// Uses only fetch and WebCrypto so the same file runs in the Supabase Edge runtime (Deno) and in Node tests.

export type NativeToken = { id: string; platform: "ios" | "android"; token: string; environment: "production" | "sandbox" };
export type NativeMessage = { title: string; body: string; url: string; tag: string; channel: "zest-shared" | "zest-briefing" | "zest-reminders"; data?: Record<string, string> };
/** ok: delivered. invalid: the token is dead and should be deleted. environment: APNs host that accepted it. */
export type NativeResult = { ok: boolean; invalid?: boolean; error?: string; environment?: "production" | "sandbox" };

export type NativeConfig = {
  apns?: { keyId: string; teamId: string; bundleId: string; privateKey: string };
  fcm?: { projectId: string; clientEmail: string; privateKey: string };
};

/** Reads credentials from Edge Function secrets. A platform without complete credentials is simply skipped. */
export function nativeConfigFromEnv(get: (name: string) => string | undefined): NativeConfig {
  const config: NativeConfig = {};
  const keyId = get("APNS_KEY_ID"), teamId = get("APNS_TEAM_ID"), key = get("APNS_PRIVATE_KEY");
  if (keyId && teamId && key) config.apns = { keyId, teamId, bundleId: get("APNS_BUNDLE_ID") || "app.zestsnap", privateKey: key };
  const account = get("FCM_SERVICE_ACCOUNT_JSON");
  if (account) {
    try {
      const json = JSON.parse(account) as { project_id?: string; client_email?: string; private_key?: string };
      if (json.project_id && json.client_email && json.private_key)
        config.fcm = { projectId: json.project_id, clientEmail: json.client_email, privateKey: json.private_key };
    } catch {
      // Malformed secret: Android stays unconfigured and delivery reports native_push_unconfigured.
    }
  }
  return config;
}

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const b64urlJson = (v: unknown) => b64url(enc.encode(JSON.stringify(v)));

function pemToDer(pem: string) {
  const body = pem.replace(/\\n/g, "\n").replace(/-----(BEGIN|END) [A-Z ]+-----/g, "").replace(/\s+/g, "");
  const raw = atob(body);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function signJwt(alg: "ES256" | "RS256", header: Record<string, string>, claims: Record<string, unknown>, pem: string) {
  const algorithm = alg === "ES256" ? { name: "ECDSA", namedCurve: "P-256" } : { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(pem), algorithm, false, ["sign"]);
  const input = `${b64urlJson({ ...header, alg, typ: "JWT" })}.${b64urlJson(claims)}`;
  // WebCrypto returns ECDSA signatures as raw r||s, which is exactly what JWS ES256 requires.
  const sig = await crypto.subtle.sign(alg === "ES256" ? { name: "ECDSA", hash: "SHA-256" } : algorithm, key, enc.encode(input));
  return `${input}.${b64url(new Uint8Array(sig))}`;
}

const APNS_HOST = { production: "https://api.push.apple.com", sandbox: "https://api.sandbox.push.apple.com" } as const;
const APNS_DEAD = new Set(["Unregistered", "BadDeviceToken", "DeviceTokenNotForTopic"]);

export function apnsPayload(m: NativeMessage) {
  return { aps: { alert: { title: m.title, body: m.body }, sound: "default", "thread-id": m.tag }, url: m.url, ...(m.data || {}) };
}

export function fcmMessage(token: string, m: NativeMessage) {
  return {
    message: {
      token,
      notification: { title: m.title, body: m.body },
      data: { url: m.url, tag: m.tag, ...(m.data || {}) },
      android: { priority: "HIGH", notification: { channel_id: m.channel, tag: m.tag, icon: "ic_stat_zest", color: "#00C6A7" } },
    },
  };
}

/** FCM v1 errors that mean the registration token will never work again. */
export function fcmTokenIsDead(status: number, body: unknown) {
  const err = (body as { error?: { status?: string; message?: string; details?: { errorCode?: string }[] } })?.error;
  const codes = (err?.details || []).map((d) => d.errorCode);
  if (status === 404 || codes.includes("UNREGISTERED")) return true;
  return status === 400 && err?.status === "INVALID_ARGUMENT" && /registration token/i.test(err?.message || "");
}

export function createNativeSender(config: NativeConfig, fetchImpl: typeof fetch = fetch, now = () => Date.now()) {
  let apnsJwt: { value: string; at: number } | null = null;
  let fcmToken: { value: string; expires: number } | null = null;

  async function apnsAuth() {
    // Apple accepts a provider token for up to an hour and rejects refreshing more than once every 20 minutes.
    if (apnsJwt && now() - apnsJwt.at < 40 * 60_000) return apnsJwt.value;
    const a = config.apns!;
    apnsJwt = { value: await signJwt("ES256", { kid: a.keyId }, { iss: a.teamId, iat: Math.floor(now() / 1000) }, a.privateKey), at: now() };
    return apnsJwt.value;
  }

  async function fcmAuth() {
    if (fcmToken && fcmToken.expires - now() > 60_000) return fcmToken.value;
    const f = config.fcm!;
    const iat = Math.floor(now() / 1000);
    const assertion = await signJwt("RS256", {}, {
      iss: f.clientEmail, scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3600,
    }, f.privateKey);
    const res = await fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
    });
    const json = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
    if (!res.ok || !json?.access_token) throw new Error("fcm_auth_failed_" + res.status);
    fcmToken = { value: json.access_token, expires: now() + (json.expires_in || 3600) * 1000 };
    return fcmToken.value;
  }

  async function sendApns(t: NativeToken, m: NativeMessage, environment: "production" | "sandbox"): Promise<NativeResult> {
    const a = config.apns!;
    const res = await fetchImpl(`${APNS_HOST[environment]}/3/device/${t.token}`, {
      method: "POST",
      headers: {
        authorization: `bearer ${await apnsAuth()}`,
        "apns-topic": a.bundleId,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "apns-collapse-id": m.tag.slice(0, 64),
        "content-type": "application/json",
      },
      body: JSON.stringify(apnsPayload(m)),
    });
    if (res.ok) return { ok: true, environment };
    const reason = ((await res.json().catch(() => null)) as { reason?: string } | null)?.reason || "";
    return { ok: false, invalid: res.status === 410 || APNS_DEAD.has(reason), error: `apns_${res.status}${reason ? "_" + reason : ""}` };
  }

  async function send(t: NativeToken, m: NativeMessage): Promise<NativeResult> {
    try {
      if (t.platform === "ios") {
        if (!config.apns) return { ok: false, error: "native_push_unconfigured" };
        const first = await sendApns(t, m, t.environment);
        // A development build's token is only valid on the sandbox host (and vice versa); Apple answers
        // BadDeviceToken on the wrong one, so try the other host before treating the token as dead.
        if (!first.ok && first.error?.endsWith("_BadDeviceToken")) {
          const other = t.environment === "production" ? "sandbox" : "production";
          const second = await sendApns(t, m, other);
          return second.ok ? second : first;
        }
        return first;
      }
      if (!config.fcm) return { ok: false, error: "native_push_unconfigured" };
      const res = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${config.fcm.projectId}/messages:send`, {
        method: "POST",
        headers: { authorization: `Bearer ${await fcmAuth()}`, "content-type": "application/json" },
        body: JSON.stringify(fcmMessage(t.token, m)),
      });
      if (res.ok) return { ok: true };
      const body = await res.json().catch(() => null);
      return { ok: false, invalid: fcmTokenIsDead(res.status, body), error: `fcm_${res.status}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message.slice(0, 80) : "native_push_failed" };
    }
  }

  return { send, configured: { ios: !!config.apns, android: !!config.fcm } };
}
