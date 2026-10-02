"use client";

import { FormEvent, useState } from "react";
import { Mail, Lock, ArrowRight, Loader2 } from "lucide-react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

export default function LoginPage() {
  const configured = isSupabaseConfigured();
  const [mode,setMode] = useState<"login"|"signup">("login");
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState("");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!configured) { setMessage("Account services are being connected. The app can still be previewed without signing in."); return; }
    setBusy(true); setMessage("");
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email")||"");
    const password = String(form.get("password")||"");
    const supabase = createClient();
    const result = mode === "login"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin + "/auth/callback" } });
    setBusy(false);
    if (result.error) setMessage(result.error.message);
    else if (mode === "signup") setMessage("Check your email to confirm your Zest Snap account.");
    else window.location.href = "/app";
  }

  return <main className="authPage"><div className="authCard">
    <a href="/" className="brand">Zest <span>Snap</span></a>
    <div className="eyebrow">{mode === "login" ? "WELCOME BACK" : "CREATE YOUR ACCOUNT"}</div>
    <h1>{mode === "login" ? "Your dates, organised." : "Start snapping."}</h1>
    <p>Use one account across devices and keep your scans, agenda, rewards and calendar connections together.</p>
    {!configured && <div className="authNotice">Backend account services are not connected yet. This page is ready for the dedicated Zest Snap Supabase project.</div>}
    <form onSubmit={submit}>
      <label><span>Email</span><div><Mail size={18}/><input name="email" type="email" required placeholder="you@example.com"/></div></label>
      <label><span>Password</span><div><Lock size={18}/><input name="password" type="password" required minLength={8} placeholder="At least 8 characters"/></div></label>
      {message && <div className="authMessage">{message}</div>}
      <button className="button authSubmit" disabled={busy}>{busy ? <Loader2 className="spin"/> : <>{mode === "login" ? "Sign in" : "Create account"} <ArrowRight size={17}/></>}</button>
    </form>
    <button className="authSwitch" onClick={()=>setMode(mode==="login"?"signup":"login")}>{mode === "login" ? "New to Zest Snap? Create an account" : "Already have an account? Sign in"}</button>
    <div className="authFine">By continuing, you agree to the <a href="/terms">Terms</a> and acknowledge the <a href="/privacy">Privacy notice</a>.</div>
  </div></main>;
}
