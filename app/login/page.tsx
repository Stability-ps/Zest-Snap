"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import SocialButtons from "./social-buttons";
import { isOAuthErrorKind, oauthErrorMessage } from "@/lib/social-auth";
import { ArrowRight, Loader2, Lock, Mail, User } from "lucide-react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { PENDING_NEXT_KEY, authLinkErrorFrom, isExistingAccountSignup, safeAuthNext } from "@/lib/auth";
import { ResendVerification } from "../auth/resend-verification";
import { useCompactAuthCard } from "../auth/compact";
import { PasswordStrength, validPassword } from "@/app/password-strength";
import { captureReferral, claimPendingReferral, registerDevice, setActiveUser, signOut } from "@/lib/session";

type Mode = "login" | "signup" | "forgot";

const copy: Record<Mode, { eyebrow: string; title: string; text: string }> = {
  login: {
    eyebrow: "",
    title: "Welcome back",
    text: "Sign in to continue planning with Zest Snap.",
  },
  signup: {
    eyebrow: "GET STARTED",
    title: "Create your Zest account",
    text: "Your plans, reminders, and important dates in one place.",
  },
  forgot: {
    eyebrow: "PASSWORD HELP",
    title: "Reset your password.",
    text: "Enter your email and we’ll send you a secure reset link.",
  },
};

export default function LoginPage() {
  const configured = isSupabaseConfigured();
  const [mode, setMode] = useState<Mode>("login");
  const [busy, setBusy] = useState(false);
  const card = useCompactAuthCard();
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [signedInAs, setSignedInAs] = useState<string | null | undefined>(undefined);
  // Email awaiting verification: after sign-up, or a sign-in refused with email_not_confirmed.
  const [pendingEmail, setPendingEmail] = useState("");
  const [checkEmail, setCheckEmail] = useState(false);
  const [email, setEmail] = useState("");

  useEffect(() => {
    captureReferral();
    const q = new URLSearchParams(window.location.search);
    if (q.get("mode") === "signup") setMode("signup");
    if (q.get("mode") === "forgot") setMode("forgot");
    // Someone already signed in must never be shown a sign-in form.
    if (configured)
      createClient()
        .auth.getUser()
        .then(({ data }) => setSignedInAs(data.user ? data.user.email || "your account" : null))
        .catch(() => setSignedInAs(null));
    else setSignedInAs(null);
    // Older links, or Supabase redirects that land here with an error, go to the result screen.
    const linkError = authLinkErrorFrom(q) || authLinkErrorFrom(new URLSearchParams(window.location.hash.slice(1)));
    if (linkError) {
      window.location.replace(`/auth/confirmed?status=${linkError}`);
      return;
    }
    if (q.get("verified") === "1") setMessage("Your email is verified. Sign in to continue.");
    const socialError = q.get("auth_error");
    if (isOAuthErrorKind(socialError)) setMessage(oauthErrorMessage[socialError]);
  }, [configured]);

  async function switchAccount() {
    setBusy(true);
    await signOut();
    setSignedInAs(null);
    setBusy(false);
  }

  function changeMode(next: Mode) {
    setMessage("");
    setPendingEmail("");
    setCheckEmail(false);
    setMode(next);
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
  }

  function authErrorMessage(code?: string, fallback?: string) {
    const normalizedFallback = fallback?.toLowerCase() || "";
    switch (code) {
      case "invalid_credentials":
        return "Incorrect email or password. Check your email address and password, then try again.";
      case "email_not_confirmed":
        return "Verify your email first. Use the link we sent you, or resend it below.";
      case "user_already_exists":
        return "An account already exists for this email. Sign in instead, or reset your password if you’ve forgotten it.";
      case "email_address_invalid":
        return "Enter a valid email address.";
      case "weak_password":
        return "Choose a stronger password that meets all required rules.";
      case "over_email_send_rate_limit":
        return "Too many emails were requested. Wait a little and try again.";
      case "signup_disabled":
        return "New account creation is temporarily unavailable.";
      default:
        if (
          normalizedFallback.includes("invalid login credentials") ||
          normalizedFallback.includes("invalid credentials")
        )
          return "Incorrect email or password. Check your email address and password, then try again.";
        if (
          normalizedFallback.includes("failed to fetch") ||
          normalizedFallback.includes("networkerror") ||
          normalizedFallback.includes("network request failed")
        )
          return "Unable to connect to Zest Snap. Check your internet connection and try again.";
        return fallback || "We could not complete that request. Please try again.";
    }
  }

  const nextPath = () => safeAuthNext(new URLSearchParams(window.location.search).get("next"));
  async function afterSignIn(userId: string) {
    // A different person may have used this device: drop their cached state before opening the app.
    setActiveUser(userId);
    await Promise.allSettled([registerDevice(), claimPendingReferral()]);
    let destination = nextPath();
    // A verified signup may finish on a different browser; server state is authoritative.
    if (destination === "/app" || destination.startsWith("/upgrade")) {
      try {
        const { data, error } = await createClient().rpc("premium_onboarding_status");
        if (!error && data?.show === true) destination = "/upgrade?from=onboarding";
      } catch { /* Never prevent sign-in when onboarding is unavailable. */ }
    }
    window.location.assign(new URL(destination, window.location.origin).href);
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!configured) {
      setMessage(
        "Sign-in is temporarily unavailable. You can still continue on this device.",
      );
      return;
    }

    setBusy(true);
    setMessage("");
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") || "");
    const password = mode === "signup" ? signupPassword : String(form.get("password") || "");
    if (mode === "signup" && !validPassword(password)) {
      setMessage("Complete the required password rules before creating your account.");
      setBusy(false);
      return;
    }
    if (mode === "signup" && password !== confirmPassword) {
      setMessage("Passwords do not match.");
      setBusy(false);
      return;
    }

    const supabase = createClient();
    try {
      if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo:
            window.location.origin + "/auth/callback?next=/reset-password",
        });
        setMessage(
          error
            ? authErrorMessage(error.code, error.message)
            : "If this email has an account, a reset link is on its way.",
        );
        return;
      }

      if (mode === "login") {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error || !data.user) {
          if (error?.code === "email_not_confirmed") setPendingEmail(email);
          setMessage(authErrorMessage(error?.code, error?.message));
          return;
        }
        await afterSignIn(data.user.id);
        return;
      }

      const cleanName = name.trim();
      if (!cleanName) {
        setMessage("Tell us your name so Zest can personalise your experience.");
        return;
      }
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: window.location.origin + "/auth/callback?next=/auth/verified",
          data: {
            display_name: cleanName,
            full_name: cleanName,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
            locale: navigator.language || "en",
          },
        },
      });
      if (error && error.code !== "user_already_exists") {
        setMessage(authErrorMessage(error.code, error.message));
        return;
      }
      if (error || isExistingAccountSignup(data.user)) {
        // Already registered and verified: Supabase sends nothing, so guide them to sign in.
        setMode("login");
        setMessage("An account already exists for this email. Sign in instead, or reset your password if you’ve forgotten it.");
        return;
      }
      if (data.session && data.user) {
        await afterSignIn(data.user.id);
      } else {
        try {
          if (nextPath() !== "/app") localStorage.setItem(PENDING_NEXT_KEY, nextPath());
        } catch {}
        setPendingEmail(email);
        setCheckEmail(true);
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? authErrorMessage(undefined, error.message)
          : "Unable to connect to Zest Snap. Check your internet connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  const current = copy[mode];

  return (
    <main className="authPage">
      <div {...card}>
        <div className="authBrandRow">
          <Link href="https://zestsnap.app" className="brand">
            Zest <span>Snap</span>
          </Link>
          {current.eyebrow && <div className="eyebrow">{current.eyebrow}</div>}
        </div>

        {signedInAs === undefined ? (
          <p className="authIntro" role="status">
            Checking your account…
          </p>
        ) : signedInAs ? (
          <>
            <h1>You’re signed in.</h1>
            <p className="authIntro">
              Signed in as <b>{signedInAs}</b>. Manage your account in Settings, or sign out to use a different account.
            </p>
            <a className="button authSubmit" href={nextPath() === "/app" ? "/app" : nextPath()}>
              Continue to Zest Snap <ArrowRight size={17} />
            </a>
            <div className="authLinks">
              <a className="authSwitch" href="/settings">
                Manage account
              </a>
              <button className="authSwitch" onClick={switchAccount} disabled={busy}>
                Sign out and use another account
              </button>
            </div>
          </>
        ) : checkEmail ? (
          <>
            <h1>Verify your email.</h1>
            <p className="authIntro" role="status">
              Check your email to verify your Zest Snap account.
            </p>
            <p className="authIntro">
              We sent a link to <b>{pendingEmail}</b>. It expires in an hour. Can’t find it? Check spam or promotions.
            </p>
            <ResendVerification email={pendingEmail} />
            <div className="authLinks">
              <button className="authSwitch" onClick={() => changeMode("login")}>
                Already verified? Sign in
              </button>
              <button className="authSwitch" onClick={() => changeMode("signup")}>
                Use a different email
              </button>
            </div>
          </>
        ) : (
          <>
        <h1>{current.title}</h1>
          <p className="authIntro">{current.text}</p>

          {mode !== "forgot" && configured && <SocialButtons next={nextPath()} disabled={busy} onError={setMessage} />}
          <form onSubmit={submit}>
            {mode === "signup" && (
              <label>
                <span>Your name</span>
                <div>
                  <User size={18} />
                  <input
                    name="name"
                    type="text"
                    required
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="What should Zest call you?"
                  />
                </div>
              </label>
            )}
            <label>
              <span>Email address</span>
              <div>
                <Mail size={18} />
                <input
                  name="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="email"
                  required
                  autoComplete="email"
                  inputMode="email"
                  placeholder="you@example.com"
                />
              </div>
            </label>

            {mode !== "forgot" && (
              <label>
                <span>Password</span>
                {mode === "signup" ? (
                  <PasswordStrength value={signupPassword} onChange={setSignupPassword} icon={<Lock size={18} />} />
                ) : (
                  <div>
                    <Lock size={18} />
                    <input name="password" type="password" required autoComplete="current-password" />
                  </div>
                )}
              </label>
            )}

            {mode === "signup" && (
              <label>
                <span>Confirm password</span>
                <div><Lock size={18} /><input type="password" required autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} /></div>
                {confirmPassword && <small role="status" style={{ color: signupPassword === confirmPassword ? "var(--success-text)" : "var(--danger-text)" }}>{signupPassword === confirmPassword ? "Passwords match" : "Passwords do not match"}</small>}
              </label>
            )}
            {message && (
              <div className="authMessage" role="status" aria-live="polite">
                {message}
              </div>
            )}
            {mode === "login" && pendingEmail && <ResendVerification email={pendingEmail} />}

            <button className="button authSubmit" disabled={busy || (mode === "signup" && (!validPassword(signupPassword) || signupPassword !== confirmPassword))}>
              {busy ? (
                <Loader2 className="spin" />
              ) : (
                <>
                  {mode === "forgot"
                    ? "Send reset link"
                    : mode === "login"
                      ? "Sign in"
                      : "Create account"}
                  <ArrowRight size={17} />
                </>
              )}
            </button>
          </form>

          <div className="authLinks">
            {mode === "login" ? (
              <>
                <button className="authSwitch" onClick={() => changeMode("signup")}>
                  Don’t have an account? Create account
                </button>
                <button className="authSwitch" onClick={() => changeMode("forgot")}>
                  Forgot password?
                </button>
              </>
            ) : (
              <button className="authSwitch" onClick={() => changeMode("login")}>
                {mode === "signup" ? "Already have an account? Sign in" : "Back to sign in"}
              </button>
            )}
          </div>

          </>
        )}

        <div className="authDivider">
          <span>or</span>
        </div>
        <Link className="authDeviceButton" href="/app">
          Continue on this device
        </Link>

        <div className="authFine">
          By continuing, you agree to the <a href="/terms">Terms</a> and
          acknowledge the <a href="/privacy">Privacy notice</a>.
        </div>
      </div>
    </main>
  );
}
