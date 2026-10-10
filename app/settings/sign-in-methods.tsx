"use client";

import { useEffect, useState } from "react";
import { Check, KeyRound, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { isNative, runtime } from "@/lib/native/runtime";
import { fetchEnabledProviders, oauthErrorKind, oauthErrorMessage, oauthRedirect, providerLabel, providerOrder, type SocialProvider } from "@/lib/social-auth";

type Identity = { provider: string; email: string | null };

/**
 * Settings › Account › Sign-in methods. Connecting Google or Apple happens only from inside the signed-in
 * account (Supabase manual identity linking): the person proves they own this account first, so two accounts
 * are never merged just because their providers report the same email. Methods are not removed here, so
 * nobody can lock themselves out.
 */
export default function SignInMethods({ onMessage }: { onMessage: (m: string) => void }) {
  const [identities, setIdentities] = useState<Identity[] | null>(null);
  const [available, setAvailable] = useState<SocialProvider[]>([]);
  const [busy, setBusy] = useState<SocialProvider | null>(null);

  useEffect(() => {
    const { url, key } = getSupabasePublicConfig();
    fetchEnabledProviders(url, key).then((p) => setAvailable(providerOrder(runtime(), p)));
    createClient()
      .auth.getUserIdentities()
      .then(({ data }) =>
        setIdentities(
          (data?.identities || []).map((i) => ({ provider: i.provider, email: typeof i.identity_data?.email === "string" ? i.identity_data.email : null })),
        ),
      )
      .catch(() => setIdentities([]));
  }, []);

  async function connect(provider: SocialProvider) {
    setBusy(provider);
    const native = isNative();
    try {
      const { data, error } = await createClient().auth.linkIdentity({
        provider,
        options: {
          redirectTo: oauthRedirect({ origin: window.location.origin, provider, next: "/settings", native, link: true }),
          skipBrowserRedirect: native,
          queryParams: provider === "google" ? { prompt: "select_account" } : undefined,
        },
      });
      if (error) throw error;
      if (native && data?.url) window.location.assign(data.url);
    } catch (e) {
      const err = e as { code?: string; message?: string };
      onMessage(err?.code === "manual_linking_disabled" ? oauthErrorMessage.unavailable : oauthErrorMessage[oauthErrorKind(err?.code, err?.message)]);
      setBusy(null);
    }
  }

  if (!identities) return null;
  const linked = new Set(identities.map((i) => i.provider));
  const label = (p: string) => (p === "email" ? "Email and password" : p === "google" || p === "apple" ? providerLabel[p] : p);
  const connectable = available.filter((p) => !linked.has(p));
  return (
    <section className="signInMethods" aria-labelledby="sign-in-methods">
      <h3 id="sign-in-methods">Sign-in methods</h3>
      <ul>
        {identities.map((i) => (
          <li key={i.provider}>
            <KeyRound size={16} aria-hidden="true" />
            <span>
              <b>{label(i.provider)}</b>
              {i.email && <small>{/@privaterelay\.appleid\.com$/i.test(i.email) ? "Hidden email (Apple)" : i.email}</small>}
            </span>
            <Check size={16} aria-label="Connected" />
          </li>
        ))}
      </ul>
      {connectable.map((p) => (
        <button key={p} type="button" className="button alt" disabled={busy !== null} onClick={() => connect(p)}>
          {busy === p ? <Loader2 className="spin" size={17} aria-hidden="true" /> : null} Connect {providerLabel[p]}
        </button>
      ))}
    </section>
  );
}
