"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { isNative, runtime } from "@/lib/native/runtime";
import { fetchEnabledProviders, oauthErrorKind, oauthErrorMessage, oauthRedirect, providerLabel, providerOrder, type SocialProvider } from "@/lib/social-auth";

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.63h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.8z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.9l-3.88-3.02c-1.07.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.11A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.29 14.28A7.2 7.2 0 0 1 4.91 12c0-.79.14-1.56.38-2.28V6.61H1.28a12 12 0 0 0 0 10.78l4.01-3.11z" />
      <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.6 4.59 1.8l3.44-3.44A11.53 11.53 0 0 0 12 0 12 12 0 0 0 1.28 6.61l4.01 3.11C6.23 6.88 8.88 4.77 12 4.77z" />
    </svg>
  );
}
function AppleMark() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor">
      <path d="M16.37 12.78c-.03-2.66 2.17-3.94 2.27-4-1.24-1.81-3.16-2.06-3.84-2.09-1.63-.17-3.19.96-4.02.96-.83 0-2.11-.94-3.47-.91-1.78.03-3.43 1.04-4.35 2.63-1.86 3.22-.48 7.98 1.33 10.6.89 1.28 1.94 2.71 3.32 2.66 1.33-.05 1.84-.86 3.45-.86s2.07.86 3.48.83c1.44-.02 2.35-1.3 3.22-2.59 1.02-1.48 1.44-2.92 1.46-3-.03-.01-2.8-1.07-2.85-4.23zM13.73 4.95c.73-.89 1.23-2.12 1.09-3.35-1.05.04-2.33.7-3.08 1.59-.67.78-1.27 2.04-1.11 3.24 1.18.09 2.38-.6 3.1-1.48z" />
    </svg>
  );
}

/**
 * "Continue with Apple / Google". Only providers that are switched on in Supabase are shown, so nothing
 * appears (and nothing can break) until the Google/Apple apps are configured. Google asks which account to
 * use every time, so switching Google accounts is explicit. No extra scopes: Calendar access is a separate
 * connection in Settings.
 */
export default function SocialButtons({ next, disabled, onError }: { next: string; disabled?: boolean; onError: (message: string) => void }) {
  const [providers, setProviders] = useState<SocialProvider[] | null>(null);
  const [busy, setBusy] = useState<SocialProvider | null>(null);

  useEffect(() => {
    const { url, key } = getSupabasePublicConfig();
    fetchEnabledProviders(url, key).then((enabled) => setProviders(providerOrder(runtime(), enabled)));
  }, []);

  async function start(provider: SocialProvider) {
    if (busy) return;
    setBusy(provider);
    onError("");
    const native = isNative();
    try {
      const { data, error } = await createClient().auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: oauthRedirect({ origin: window.location.origin, provider, next, native }),
          // The apps open the provider in the system browser (Google refuses embedded WebViews) and come back
          // through zestsnap://auth/callback; the web navigates directly.
          skipBrowserRedirect: native,
          queryParams: provider === "google" ? { prompt: "select_account" } : undefined,
        },
      });
      if (error) throw error;
      if (native && data?.url) window.location.assign(data.url);
      // On the web the page is now navigating away; keep the busy state until it does.
    } catch (e) {
      const err = e as { code?: string; message?: string; name?: string };
      onError(oauthErrorMessage[!navigator.onLine ? "network" : oauthErrorKind(err?.code, err?.message || err?.name)]);
      setBusy(null);
    }
  }

  if (!providers?.length) return null;
  return (
    <div className="socialAuth" role="group" aria-label="Sign in with another account">
      {providers.map((p) => (
        <button
          key={p}
          type="button"
          className={`socialButton ${p}`}
          disabled={disabled || busy !== null}
          aria-busy={busy === p}
          onClick={() => start(p)}
        >
          {busy === p ? <Loader2 className="spin" size={20} aria-hidden="true" /> : p === "google" ? <GoogleMark /> : <AppleMark />}
          <span>Continue with {providerLabel[p]}</span>
        </button>
      ))}
      <div className="authDivider">
        <span>or</span>
      </div>
    </div>
  );
}
