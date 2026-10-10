"use client";

import { useState, type ReactNode } from "react";
import { Check, Eye, EyeOff, X } from "lucide-react";

export function passwordChecks(value: string) {
  return [
    { label: "At least 8 characters", ok: value.length >= 8 },
    { label: "One uppercase letter", ok: /[A-Z]/.test(value) },
    { label: "One lowercase letter", ok: /[a-z]/.test(value) },
    { label: "One special character", ok: /[^A-Za-z0-9\s]/.test(value) },
    { label: "A number (optional)", ok: /\d/.test(value), optional: true },
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
      {!value ? (
        // Nothing typed yet: one line, so the whole sign-up form fits on a phone screen.
        <p id={name + "-requirements"} className="passwordHint">8+ characters, upper & lowercase letters and a symbol.</p>
      ) : (
        <div id={name + "-requirements"} className="passwordRules">
          <div className="passwordRulesTop">
            <span>Password strength</span><span style={{ color }} aria-live="polite">{label}</span>
          </div>
          <div aria-hidden="true" className="passwordMeter">
            {[1,2,3].map((n) => <div key={n} style={{ background: n <= level ? color : "var(--surface-4)" }} />)}
          </div>
          <div className="passwordChecks">
            {checks.map((check) => <div key={check.label} style={{ color: check.ok ? "var(--success-text)" : "var(--text-3)" }}>
              {check.ok ? <Check size={13} /> : <X size={13} />}
              <span>{check.label}</span>
            </div>)}
          </div>
        </div>
      )}
    </>
  );
}
