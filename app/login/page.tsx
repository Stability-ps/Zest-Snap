"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { ArrowRight, Loader2, Lock, Mail } from "lucide-react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

type Mode = "login" | "signup" | "forgot";

const copy: Record<Mode, { eyebrow: string; title: string; text: string }> = {
  login: {
    eyebrow: "WELCOME BACK",
    title: "Your dates, organised.",
    text: "Sign in to keep your scans, planner, rewards and calendar connections together across devices.",
  },
  signup: {
    eyebrow: "GET STARTED",
    title: "Create your Zest account.",
    text: "Keep everything you scan and plan safely connected across your devices.",
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
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("error"))
      setMessage(
        "This link has expired or could not be verified. Request a new link and use the same browser.",
      );
  }, []);

  function changeMode(next: Mode) {
    setMessage("");
    setMode(next);
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
    const password = String(form.get("password") || "");
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (ref) sessionStorage.setItem("zest-referral", ref);

    const supabase = createClient();
    try {
      const result =
        mode === "forgot"
          ? await supabase.auth.resetPasswordForEmail(email, {
              redirectTo:
                window.location.origin + "/auth/callback?next=/reset-password",
            })
          : mode === "login"
            ? await supabase.auth.signInWithPassword({ email, password })
            : await supabase.auth.signUp({
                email,
                password,
                options: {
                  emailRedirectTo: window.location.origin + "/auth/callback",
                },
              });

      if (result.error) {
        setMessage(
          mode === "login"
            ? "We couldn’t sign you in. Check your email and password and try again."
            : "We could not complete that request. Check your details and try again.",
        );
      } else if (mode === "forgot") {
        setMessage("If this email has an account, a reset link is on its way.");
      } else if (mode === "signup") {
        setMessage("Check your email to confirm your Zest Snap account.");
      } else {
        const code =
          new URLSearchParams(window.location.search).get("ref") ||
          sessionStorage.getItem("zest-referral");
        if (code) {
          await supabase.rpc("claim_referral", { p_code: code });
          sessionStorage.removeItem("zest-referral");
        }
        window.location.assign(new URL("/app", window.location.origin).href);
      }
    } catch {
      setMessage("Connection interrupted. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const current = copy[mode];

  return (
    <main className="authPage">
      <div className="authCard">
        <div className="authBrandRow">
          <Link href="/" className="brand">
            Zest <span>Snap</span>
          </Link>
          <div className="eyebrow">{current.eyebrow}</div>
        </div>

        <h1>{current.title}</h1>
        <p className="authIntro">{current.text}</p>

        <form onSubmit={submit}>
          <label>
            <span>Email</span>
            <div>
              <Mail size={18} />
              <input
                name="email"
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
              <div>
                <Lock size={18} />
                <input
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  placeholder="At least 8 characters"
                  autoComplete={
                    mode === "signup" ? "new-password" : "current-password"
                  }
                />
              </div>
            </label>
          )}

          {message && (
            <div className="authMessage" role="status" aria-live="polite">
              {message}
            </div>
          )}

          <button className="button authSubmit" disabled={busy}>
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
                New to Zest Snap? Create an account
              </button>
              <button className="authSwitch" onClick={() => changeMode("forgot")}>
                Forgot password?
              </button>
            </>
          ) : (
            <button className="authSwitch" onClick={() => changeMode("login")}>
              Back to sign in
            </button>
          )}
        </div>

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
