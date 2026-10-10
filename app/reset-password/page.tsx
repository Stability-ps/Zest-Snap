"use client";
import { FormEvent, useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { claimPendingReferral, registerDevice, setActiveUser } from "@/lib/session";
import { useCompactAuthCard } from "../auth/compact";
import { PasswordStrength, validPassword } from "@/app/password-strength";

/** Reached from a password reset link (signed in by the link's recovery session). */
export default function Reset() {
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    // undefined = checking; null = no recovery session (link not used, expired or opened elsewhere)
    [userId, setUserId] = useState<string | null | undefined>(undefined),
    [done, setDone] = useState(false);
  const card = useCompactAuthCard();
  const [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [showConfirmation, setShowConfirmation] = useState(false);
  const matches = confirmation.length > 0 && confirmation === password;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (!validPassword(password)) return setMessage("Complete the required password rules shown above.");
    if (!matches) return setMessage("The passwords do not match.");
    setBusy(true);
    try {
      const { error } = await createClient().auth.updateUser({ password });
      if (!error) {
        setDone(true);
        setPassword("");
        setConfirmation("");
      } else
        setMessage(
          error.code === "weak_password"
            ? "This password was rejected as too weak. Please choose another."
            : error.code === "same_password"
              ? "Choose a password you haven’t used for this account."
              : "This link could not be used. Request a new reset link.",
        );
    } catch {
      setMessage("Connection unavailable. Try again.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!isSupabaseConfigured()) return setUserId(null);
    createClient()
      .auth.getUser()
      .then(({ data }) => setUserId(data.user?.id || null))
      .catch(() => setUserId(null));
  }, []);

  async function continueToApp() {
    if (!userId) return;
    setBusy(true);
    setActiveUser(userId);
    await Promise.allSettled([registerDevice(), claimPendingReferral()]);
    window.location.assign(new URL("/app", window.location.origin).href);
  }

  return (
    <main className="authPage">
      <div {...card}>
        <div className="authBrandRow">
          <span className="brand">
            Zest <span>Snap</span>
          </span>
          <div className="eyebrow">PASSWORD HELP</div>
        </div>
        {userId === undefined ? (
          <p className="authIntro" role="status">
            Checking your reset link…
          </p>
        ) : done ? (
          <>
            <CheckCircle2 className="authResultIcon" size={44} aria-hidden />
            <h1>Password updated.</h1>
            <p className="authIntro" role="status">
              Use your new password next time you sign in.
            </p>
            <button className="button authSubmit" onClick={continueToApp} disabled={busy}>
              Continue to Zest Snap <ArrowRight size={17} />
            </button>
          </>
        ) : !userId ? (
          <>
            <h1>This reset link can’t be used.</h1>
            <p className="authIntro">
              It has expired, was already used, or was opened in a different browser. Request a new link and open the
              newest email.
            </p>
            <a className="button authSubmit" href="/login?mode=forgot">
              Request a new reset link <ArrowRight size={17} />
            </a>
            <div className="authLinks">
              <a className="authSwitch" href="/login">
                Back to sign in
              </a>
            </div>
          </>
        ) : (
          <>
            <h1>Choose a new password.</h1>
            <p className="authIntro">Choose a strong new password to secure your Zest Snap account.</p>
            <form onSubmit={submit}>
              <label>
                <span>New password</span>
                <PasswordStrength value={password} onChange={setPassword} />
              </label>
              <label>
                <span>Confirm new password</span>
                <div>
                  <input type={showConfirmation ? "text" : "password"} name="confirmation" required value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="new-password" placeholder="Enter the password again" />
                  <button type="button" onPointerDown={(event) => event.preventDefault()} onClick={(event) => { event.preventDefault(); event.stopPropagation(); setShowConfirmation((visible) => !visible); }} aria-label={showConfirmation ? "Hide confirmation" : "Show confirmation"} style={{ border: 0, background: "transparent", cursor: "pointer", padding: 5, display: "flex" }}>{showConfirmation ? <EyeOff size={19} /> : <Eye size={19} />}</button>
                </div>
                {confirmation && <span style={{ marginTop: 6, color: matches ? "var(--success-text)" : "var(--warning-text)" }}>{matches ? "Passwords match" : "Passwords do not match yet"}</span>}
              </label>
              {message && (
                <div className="authMessage" role="alert" aria-live="polite">
                  {message}
                </div>
              )}
              <button className="button authSubmit" type="submit" disabled={busy || !validPassword(password) || !matches}>
                {busy ? "Updating…" : "Update password"}
              </button>
            </form>
            <div className="authLinks">
              <a className="authSwitch" href="/login?mode=forgot">
                Request a new link
              </a>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
