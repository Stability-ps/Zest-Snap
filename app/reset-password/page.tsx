"use client";
import { useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
export default function Reset() {
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="authPage">
      <div className="authCard">
        <h1>Reset password</h1>
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
            New password
            <input
              type="password"
              name="password"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </label>
          <button className="button" disabled={busy}>
            Update password
          </button>
        </form>
        <p role="status">{message}</p>
        <a href="/login?mode=forgot">Request a new link</a> ·{" "}
        <a href="/app">Open Zest Snap</a>
      </div>
    </main>
  );
}
