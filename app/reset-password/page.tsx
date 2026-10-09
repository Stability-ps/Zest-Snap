"use client";
import { useState } from "react";
import { PasswordStrength, validPassword } from "@/app/password-strength";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
export default function Reset() {
  const [password, setPassword] = useState(""),
    [confirmPassword, setConfirmPassword] = useState(""),
    [message, setMessage] = useState(""),
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
            if (!validPassword(password)) {
              setMessage("Complete the required password rules shown above.");
              return;
            }
            if (password !== confirmPassword) {
              setMessage("Passwords do not match.");
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
            <PasswordStrength value={password} onChange={setPassword} />
          </label>
          <label>
            Confirm new password
            <input type="password" required autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            {confirmPassword && <small role="status" style={{ color: password === confirmPassword ? "#047857" : "#b91c1c" }}>{password === confirmPassword ? "Passwords match" : "Passwords do not match"}</small>}
          </label>
          <button className="button" disabled={busy || !validPassword(password) || password !== confirmPassword}>
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
