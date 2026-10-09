"use client";
import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, Lock } from "lucide-react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { claimPendingReferral, registerDevice, setActiveUser } from "@/lib/session";
import { useCompactAuthCard } from "../auth/compact";

/** Reached from a password reset link (signed in by the link's recovery session). */
export default function Reset() {
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    // undefined = checking; null = no recovery session (link not used, expired or opened elsewhere)
    [userId, setUserId] = useState<string | null | undefined>(undefined),
    [done, setDone] = useState(false);
  const card = useCompactAuthCard();

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
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const password = String(new FormData(e.currentTarget).get("password"));
                if (password.length < 8) {
                  setMessage("Choose a password with at least 8 characters.");
                  return;
                }
                setBusy(true);
                setMessage("");
                try {
                  const { error } = await createClient().auth.updateUser({ password });
                  if (!error) setDone(true);
                  else
                    setMessage(
                      error.code === "weak_password"
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
                <div>
                  <Lock size={18} />
                  <input type="password" name="password" required minLength={8} autoComplete="new-password" placeholder="At least 8 characters" />
                </div>
              </label>
              {message && (
                <div className="authMessage" role="status" aria-live="polite">
                  {message}
                </div>
              )}
              <button className="button authSubmit" disabled={busy}>
                Update password
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
