"use client";

import { useEffect, useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { RESEND_COOLDOWN_SECONDS, recordResend, resendWaitSeconds } from "@/lib/auth";

/**
 * "Resend verification email" with a per-address cooldown that matches Supabase's own one-email-per-minute
 * limit (Supabase still enforces its hourly cap server-side). Pass `email` when it is already known;
 * otherwise the person types it.
 */
export function ResendVerification({ email: knownEmail, label = "Resend verification email" }: { email?: string; label?: string }) {
  const [email, setEmail] = useState(knownEmail || "");
  const [wait, setWait] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!email) return;
    const tick = () => setWait(resendWaitSeconds(localStorage, email));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [email]);

  async function resend() {
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setMessage("Enter the email address you signed up with.");
      return;
    }
    if (!isSupabaseConfigured()) {
      setMessage("Cloud accounts are not active.");
      return;
    }
    if (resendWaitSeconds(localStorage, address) > 0) return;
    setBusy(true);
    setMessage("");
    try {
      const { error } = await createClient().auth.resend({
        type: "signup",
        email: address,
        options: { emailRedirectTo: window.location.origin + "/auth/callback" },
      });
      if (error) {
        if (error.status === 429 || error.code === "over_email_send_rate_limit") {
          recordResend(localStorage, address);
          setMessage("Too many emails were requested. Wait a few minutes, then try again.");
        } else setMessage("We couldn’t send the email. Check the address and try again.");
        return;
      }
      recordResend(localStorage, address);
      setWait(RESEND_COOLDOWN_SECONDS);
      // Supabase doesn't reveal whether the address is registered or already verified.
      setMessage("If this email has an unverified Zest Snap account, a new verification link is on its way. Already verified? Sign in instead.");
    } catch {
      setMessage("Unable to connect to Zest Snap. Check your internet connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="authResend">
      {!knownEmail && (
        <label>
          <span>Email</span>
          <div>
            <Mail size={18} />
            <input
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </label>
      )}
      <button type="button" className="button authSubmit authSecondary" onClick={resend} disabled={busy || wait > 0}>
        {busy ? <Loader2 className="spin" /> : wait > 0 ? `Resend available in ${wait}s` : label}
      </button>
      {message && (
        <div className="authMessage" role="status" aria-live="polite">
          {message}
        </div>
      )}
    </div>
  );
}
