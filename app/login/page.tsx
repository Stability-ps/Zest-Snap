"use client";

import Link from "next/link";
import { FormEvent, useState, useEffect } from "react";
import { Mail, Lock, ArrowRight, Loader2 } from "lucide-react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

export default function LoginPage() {
  const configured = isSupabaseConfigured();
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("error"))
      setMessage(
        "This link has expired or could not be verified. Request a new link and use the same browser.",
      );
  }, []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!configured) {
      setMessage(
        "Account services are being connected. The app can still be previewed without signing in.",
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
      setBusy(false);
      if (result.error)
        setMessage(
          "We could not complete that request. Check your details or try a new link.",
        );
      else if (mode === "forgot")
        setMessage("If this email has an account, a reset link is on its way.");
      else if (mode === "signup")
        setMessage("Check your email to confirm your Zest Snap account.");
      else {
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

  return (
    <main className="authPage">
      <div className="authCard">
        <Link href="/" className="brand">
          Zest <span>Snap</span>
        </Link>
        <div className="eyebrow">
          {mode === "login" ? "WELCOME BACK" : "CREATE YOUR ACCOUNT"}
        </div>
        <h1>
          {mode === "login" ? "Your dates, organised." : "Start snapping."}
        </h1>
        <p>
          Use one account across devices and keep your scans, agenda, rewards
          and calendar connections together.
        </p>
        {!configured && (
          <div className="authNotice">
            Backend account services are not connected yet. This page is ready
            for the dedicated Zest Snap Supabase project.
          </div>
        )}
        <form onSubmit={submit}>
          <label>
            <span>Email</span>
            <div>
              <Mail size={18} />
              <input
                name="email"
                type="email"
                required
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
          {message && <div className="authMessage">{message}</div>}
          <button className="button authSubmit" disabled={busy}>
            {busy ? (
              <Loader2 className="spin" />
            ) : (
              <>
                {mode === "forgot"
                  ? "Send reset link"
                  : mode === "login"
                    ? "Sign in"
                    : "Create account"}{" "}
                <ArrowRight size={17} />
              </>
            )}
          </button>
        </form>
        <button
          className="authSwitch"
          onClick={() => setMode(mode === "login" ? "signup" : "login")}
        >
          {mode === "login"
            ? "New to Zest Snap? Create an account"
            : "Already have an account? Sign in"}
        </button>
        <button className="authSwitch" onClick={() => setMode("forgot")}>
          Forgot password?
        </button>
        <p>
          <a href="/app">Continue on this device</a>
        </p>
        <div className="authFine">
          By continuing, you agree to the <a href="/terms">Terms</a> and
          acknowledge the <a href="/privacy">Privacy notice</a>.
        </div>
      </div>
    </main>
  );
}
