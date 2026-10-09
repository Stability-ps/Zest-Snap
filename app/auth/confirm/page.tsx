"use client";

import { useEffect, useRef } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { authLinkDestination, authLinkErrorFrom, authLinkErrorStatus, emailLinkType } from "@/lib/auth";

/**
 * Email links (`?token_hash=…&type=…`). The token is verified here in the browser rather than on a GET
 * route so link scanners that prefetch emails can't use up the one-time token, and so it works in any
 * browser or app (no PKCE verifier from the signing-up browser is needed).
 */
export default function ConfirmEmailLink() {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    const go = (path: string) => window.location.replace(path);
    const linkError = authLinkErrorFrom(params) || authLinkErrorFrom(new URLSearchParams(window.location.hash.slice(1)));
    const tokenHash = params.get("token_hash");
    const type = emailLinkType(params.get("type"));
    if (linkError) return go(`/auth/confirmed?status=${linkError}`);
    if (!tokenHash || !type || !isSupabaseConfigured()) return go("/auth/confirmed?status=invalid");

    createClient()
      .auth.verifyOtp({ token_hash: tokenHash, type })
      .then(({ error }) => {
        if (error) {
          console.info(JSON.stringify({ event: "auth_confirm_failed", code: error.code || error.name }));
          return go(`/auth/confirmed?status=${authLinkErrorStatus(error.code, error.message)}${type === "recovery" ? "&type=recovery" : ""}`);
        }
        go(authLinkDestination({ type }));
      })
      .catch(() => go("/auth/confirmed?status=invalid"));
  }, []);

  return (
    <main className="authPage">
      <div className="authCard">
        <div className="authBrandRow">
          <span className="brand">
            Zest <span>Snap</span>
          </span>
        </div>
        <h1>Checking your link…</h1>
        <p className="authIntro" role="status">
          One moment while we confirm this link.
        </p>
      </div>
    </main>
  );
}
