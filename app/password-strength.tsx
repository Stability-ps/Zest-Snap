"use client";

import { useState, type ReactNode } from "react";
import { Check, Eye, EyeOff, X } from "lucide-react";

export function passwordChecks(value: string) {
  return [
    { label: "At least 8 characters", ok: value.length >= 8 },
    { label: "One uppercase letter", ok: /[A-Z]/.test(value) },
    { label: "One lowercase letter", ok: /[a-z]/.test(value) },
    { label: "One special character", ok: /[^A-Za-z0-9\s]/.test(value) },
    { label: "One number (for very strong)", ok: /\d/.test(value), optional: true },
  ];
}
export function validPassword(value: string) {
  return passwordChecks(value).slice(0, 4).every((check) => check.ok);
}
/**
 * Password field plus live rules. Renders two siblings for an auth-form <label>: the field row (styled like every
 * other auth field) and the rules panel below it.
 */
export function PasswordStrength({ value, onChange, name = "password", icon }: {
  value: string; onChange: (value: string) => void; name?: string; icon?: ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const checks = passwordChecks(value);
  const requiredMet = checks.slice(0, 4).every((check) => check.ok);
  const level = !value ? 0 : requiredMet ? (checks[4].ok && value.length >= 12 ? 3 : 2) : checks.slice(0, 4).filter((check) => check.ok).length >= 3 ? 2 : 1;
  const label = !value ? "Enter a password" : !requiredMet && level === 2 ? "Almost ready" : ["Enter a password", "Weak", "Strong", "Very strong"][level];
  const color = !requiredMet && level === 2 ? "var(--text-2)" : ["var(--text-4)", "var(--danger-text)", "var(--success)", "var(--success-text)"][level];
  return (
    <>
      <div>
        {icon}
        <input name={name} type={visible ? "text" : "password"} required minLength={8}
          autoComplete="new-password" value={value} onChange={(e) => onChange(e.target.value)}
          aria-describedby={name + "-requirements"} />
        <button type="button" onPointerDown={(e) => e.preventDefault()} onClick={() => setVisible(!visible)}
          aria-label={visible ? "Hide password" : "Show password"}
          style={{ border: 0, background: "transparent", cursor: "pointer", color: "var(--text-3)", padding: 5, display: "flex" }}>
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      <div id={name + "-requirements"} className="passwordRules">
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700, color: "var(--text-2)" }}>
          <span>Password strength</span><span style={{ color }} aria-live="polite">{label}</span>
        </div>
        {!requiredMet && value && <p role="status" style={{ fontSize: 12, marginTop: 7, color: "var(--text-2)" }}>Still needed: {checks.slice(0, 4).filter((check) => !check.ok).map((check) => check.label.toLowerCase()).join(", ")}.</p>}\n        <div aria-hidden="true" style={{ display: "flex", gap: 5, marginTop: 8, marginBottom: 12 }}>
          {[1,2,3].map((n) => <div key={n} style={{ height: 5, flex: 1, borderRadius: 8, background: n <= level ? color : "var(--surface-4)", transition: "background .2s" }} />)}
        </div>
        <div style={{ display: "grid", gap: 7 }}>
          {checks.map((check) => <div key={check.label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: check.ok ? "var(--success-text)" : "var(--text-3)" }}>
            {check.ok ? <Check size={14} /> : <X size={14} />}
            <span>{check.label}</span>
          </div>)}
        </div>
      </div>
    </>
  );
}
