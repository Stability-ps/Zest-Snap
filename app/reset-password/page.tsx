"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, CheckCircle2 } from "lucide-react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

export default function Reset() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);

  const checks = [
    { label: "At least 8 characters", passed: password.length >= 8 },
    { label: "One uppercase letter", passed: /[A-Z]/.test(password) },
    { label: "One lowercase letter", passed: /[a-z]/.test(password) },
    { label: "One number", passed: /\d/.test(password) },
    { label: "One special character", passed: /[^A-Za-z0-9]/.test(password) },
  ];
  const passed = checks.filter((check) => check.passed).length;
  const valid = passed === checks.length;
  const strength = !password ? "" : passed <= 2 ? "Weak" : passed <= 4 ? "Good" : "Strong";
  const matches = confirmation.length > 0 && confirmation === password;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (!valid) {
      setMessage("Please meet all password requirements before continuing.");
      return;
    }
    if (!matches) {
      setMessage("The passwords do not match.");
      return;
    }
    if (!isSupabaseConfigured()) {
      setMessage("Cloud accounts are not active.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await createClient().auth.updateUser({ password });
      if (!error) {
        setSuccess(true);
        setPassword("");
        setConfirmation("");
      } else if (error.code === "weak_password") {
        setMessage("This password was rejected as too weak. Please choose another.");
      } else if (error.code === "same_password") {
        setMessage("Choose a password you have not used for this account.");
      } else {
        setMessage("This reset link could not be used. Request a fresh link and try again.");
      }
    } catch {
      setMessage("Connection unavailable. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="authPage">
      <div className="authCard">
        <div className="authBrandRow">
          <Link href="https://zestsnap.app" className="brand">Zest <span>Snap</span></Link>
          <div className="eyebrow">ACCOUNT SECURITY</div>
        </div>
        {success ? (
          <div role="status" aria-live="polite">
            <CheckCircle2 size={40} color="#0d9488" aria-hidden="true" />
            <h1 style={{ marginTop: 14 }}>Password updated.</h1>
            <p className="authIntro">Your password has been changed successfully. You can now sign in with your new password.</p>
            <Link className="button authSubmit" style={{ marginTop: 24 }} href="/login">Sign in to Zest Snap</Link>
          </div>
        ) : (
          <>
            <h1>Reset your password.</h1>
            <p className="authIntro">Choose a strong new password to secure your Zest Snap account.</p>
            <form onSubmit={submit}>
              <label>
                <span>New password</span>
                <div>
                  <input type={showPassword ? "text" : "password"} name="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder="Enter a new password" aria-describedby="password-requirements" />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Hide password" : "Show password"} style={{ border: 0, background: "transparent", cursor: "pointer", padding: 5, display: "flex" }}>{showPassword ? <EyeOff size={19} /> : <Eye size={19} />}</button>
                </div>
              </label>
              <div id="password-requirements" style={{ fontSize: 12, color: "#526176" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, marginBottom: 6 }}><span>Password strength</span><span aria-live="polite">{strength || "Not entered"}</span></div>
                <div role="meter" aria-label="Password strength" aria-valuemin={0} aria-valuemax={5} aria-valuenow={passed} style={{ display: "flex", gap: 5, marginBottom: 10 }}>
                  {[1, 2, 3, 4, 5].map((n) => <span key={n} style={{ flex: 1, height: 5, borderRadius: 4, background: n <= passed ? (passed <= 2 ? "#dc6b61" : passed <= 4 ? "#e3a13b" : "#0d9488") : "#e5e7eb" }} />)}
                </div>
                {checks.map((check) => <div key={check.label} style={{ marginTop: 4, color: check.passed ? "#087f68" : "#64748b" }}>{check.passed ? "✓" : "○"} {check.label}</div>)}
              </div>
              <label>
                <span>Confirm new password</span>
                <div>
                  <input type={showConfirmation ? "text" : "password"} name="confirmation" required value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="new-password" placeholder="Enter the password again" />
                  <button type="button" onClick={() => setShowConfirmation(!showConfirmation)} aria-label={showConfirmation ? "Hide confirmation" : "Show confirmation"} style={{ border: 0, background: "transparent", cursor: "pointer", padding: 5, display: "flex" }}>{showConfirmation ? <EyeOff size={19} /> : <Eye size={19} />}</button>
                </div>
                {confirmation && <span style={{ marginTop: 6, color: matches ? "#087f68" : "#b45309" }}>{matches ? "Passwords match" : "Passwords do not match yet"}</span>}
              </label>
              <button className="button authSubmit" type="submit" disabled={busy || !valid || !matches} style={{ opacity: busy || !valid || !matches ? 0.55 : 1, cursor: busy || !valid || !matches ? "not-allowed" : "pointer" }}>{busy ? "Updating…" : "Update password"}</button>
            </form>
            {message && <p className="authMessage" role="alert">{message}</p>}
            <div className="authLinks">
              <a className="authSwitch" href="/login?mode=forgot">Request a new link</a>
              <a className="authSwitch" href="/app">Open Zest Snap</a>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
