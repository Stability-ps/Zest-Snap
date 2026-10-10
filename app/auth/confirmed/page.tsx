"use client";

import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { AUTH_LINK_STATUSES, PENDING_NEXT_KEY, safeAuthNext, type AuthLinkStatus } from "@/lib/auth";
import { claimPendingReferral, registerDevice, setActiveUser } from "@/lib/session";
import { ResendVerification } from "../resend-verification";
import { useCompactAuthCard } from "../compact";

type View = { status: AuthLinkStatus; recovery: boolean; userId: string | null; confirmed: boolean; next: string };

/** Result screen for every email link: verified, expired/used, invalid, or not finished on this browser. */
export default function EmailLinkResult() {
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const card = useCompactAuthCard();

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const raw = q.get("status") as AuthLinkStatus;
    const status = AUTH_LINK_STATUSES.includes(raw) ? raw : "invalid";
    let next = safeAuthNext(q.get("next"));
    try {
      if (next === "/app") next = safeAuthNext(localStorage.getItem(PENDING_NEXT_KEY));
    } catch {}
    const base = { status, recovery: q.get("type") === "recovery", next };
    if (!isSupabaseConfigured()) return setView({ ...base, userId: null, confirmed: false });
    createClient()
      .auth.getUser()
      .then(({ data }) => setView({ ...base, userId: data.user?.id || null, confirmed: !!data.user?.email_confirmed_at }))
      .catch(() => setView({ ...base, userId: null, confirmed: false }));
  }, []);

  async function continueToApp() {
    if (!view) return;
    setBusy(true);
    try {
      localStorage.removeItem(PENDING_NEXT_KEY);
    } catch {}
    if (view.userId) {
      // Same as signing in: drop another account's cached state, then register this device.
      setActiveUser(view.userId);
      await Promise.allSettled([registerDevice(), claimPendingReferral()]);
      let destination = view.next;
      // Only successful signup confirmation is eligible. Email changes and recovery bypass this gate.
      if (view.status === "verified" && view.confirmed && (view.next === "/app" || view.next.startsWith("/upgrade"))) {
        try {
          const { data, error } = await createClient().rpc("premium_onboarding_status");
          if (!error && data?.show === true) destination = "/upgrade?from=onboarding";
        } catch { /* Never block verified users if the onboarding service is unavailable. */ }
      }
      window.location.assign(new URL(destination, window.location.origin).href);
    } else window.location.assign(new URL("/login?verified=1" + (view.next !== "/app" ? "&next=" + encodeURIComponent(view.next) : ""), window.location.origin).href);
  }

  const success = view && (view.status === "verified" || view.status === "email-changed");
  // A used confirmation link for an account that is already verified and signed in here.
  const alreadyVerified = view && !success && !view.recovery && view.confirmed;

  return (
    <main className="authPage">
      <div {...card}>
        <div className="authBrandRow">
          <span className="brand">
            Zest <span>Snap</span>
          </span>
        </div>
        {!view ? (
          <p className="authIntro" role="status">
            Checking your account…
          </p>
        ) : success || alreadyVerified ? (
          <>
            <CheckCircle2 className="authResultIcon" size={44} aria-hidden />
            <h1>
              {view.status === "email-changed"
                ? "Email address updated."
                : alreadyVerified
                  ? "Your email is already verified."
                  : "Email verified successfully."}
            </h1>
            <p className="authIntro">
              {view.userId
                ? "Your Zest Snap account is ready."
                : "Your Zest Snap account is ready. Sign in on this device to continue."}
            </p>
            <button className="button authSubmit" onClick={continueToApp} disabled={busy}>
              {view.userId ? "Continue to Zest Snap" : "Sign in to Zest Snap"} <ArrowRight size={17} />
            </button>
            {!view.userId && (
              <div className="authLinks">
                <a className="authSwitch" href="zestsnap://login?verified=1">
                  Open the installed Zest Snap app
                </a>
                <p className="authIntro">If the app doesn’t open, use Sign in above. Your email verification is still complete.</p>
              </div>
            )}
          </>
        ) : view.recovery ? (
          <>
            <h1>This reset link can’t be used.</h1>
            <p className="authIntro">
              {view.status === "expired"
                ? "It has expired or was already used. Password reset links work once and expire after an hour."
                : "The link is incomplete or invalid."}{" "}
              Request a new one and use the newest email.
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
        ) : view.status === "unfinished" ? (
          <>
            <h1>Open the link where you started.</h1>
            <p className="authIntro">
              This link was opened in a different browser or app from the one you used. If you were verifying
              your email, it is now verified — sign in to continue. If you were resetting your password, request a
              new reset link.
            </p>
            <a className="button authSubmit" href="/login">
              Sign in to Zest Snap <ArrowRight size={17} />
            </a>
            <div className="authLinks">
              <a className="authSwitch" href="/login?mode=forgot">
                Request a new reset link
              </a>
            </div>
          </>
        ) : (
          <>
            <h1>{view.status === "expired" ? "This link has expired." : "This link isn’t valid."}</h1>
            <p className="authIntro">
              {view.status === "expired"
                ? "Verification links work once and expire after an hour. If you already verified your email, just sign in."
                : "The link is incomplete or was changed. Use the newest email from Zest Snap, or request a new one."}
            </p>
            <ResendVerification />
            <div className="authLinks">
              <a className="authSwitch" href="/login">
                Already verified? Sign in
              </a>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
