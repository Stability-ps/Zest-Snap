"use client";
import { useState } from "react";
import Link from "next/link";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
export default function Reset() {
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="authPage">
      <div className="authCard">
        <div className="authBrandRow"><Link href="https://zestsnap.app" className="brand">Zest <span>Snap</span></Link><div className="eyebrow">ACCOUNT SECURITY</div></div>
        <h1>Reset your password.</h1>
        <p className="authIntro">Choose a new password to secure your Zest Snap account.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!isSupabaseConfigured()) {
              setMessage("Cloud accounts are not active.");
              return;
            }
            const password = String(
              new FormData(e.currentTarget).get("password"),
            );
            if (password.length < 8) {
              setMessage("Choose a password with at least 8 characters.");
              return;
            }
            setBusy(true);
            try {
              const { error } = await createClient().auth.updateUser({
                password,
              });
              setMessage(
                !error
                  ? "Password updated. You can return to Zest Snap."
                  : error.code === "weak_password"
                    ? "Choose a stronger password with at least 8 characters."
                    : error.code === "same_password"
                      ? "Choose a password you haven’t used for this account."
                      : "This link could not be used. Request a new reset link.",
              );
            } catch {
              setMessage("Connection unavailable. Try again.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            <span>New password</span>
            <div><input
              type="password"
              name="password"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="At least 8 characters"
            /></div>
          </label>
          <button className="button authSubmit" disabled={busy}>
            Update password
          </button>
        </form>
        {message && <p className="authMessage" role="status">{message}</p>}
        <div className="authLinks"><a className="authSwitch" href="/login?mode=forgot">Request a new link</a><a className="authSwitch" href="/app">Open Zest Snap</a></div>
      </div>
    </main>
  );
}
