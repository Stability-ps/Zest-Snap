"use client";

import { useState } from "react";
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
export function PasswordStrength({ value, onChange, name = "password" }: {
  value: string; onChange: (value: string) => void; name?: string;
}) {
  const [visible, setVisible] = useState(false);
  const checks = passwordChecks(value);
  const requiredMet = checks.slice(0, 4).every((check) => check.ok);
  const level = !value ? 0 : requiredMet ? (checks[4].ok && value.length >= 12 ? 3 : 2) : 1;
  const label = ["Enter a password", "Weak", "Strong", "Very strong"][level];
  const color = ["#94a3b8", "#dc5757", "#0d9488", "#047857"][level];
  return (
    <div className="zestPassword">
      <div style={{ position: "relative" }}>
        <input name={name} type={visible ? "text" : "password"} required minLength={8}
          autoComplete="new-password" value={value} onChange={(e) => onChange(e.target.value)}
          aria-describedby={name + "-requirements"} style={{ paddingRight: 48, width: "100%" }} />
        <button type="button" onClick={() => setVisible(!visible)}
          aria-label={visible ? "Hide password" : "Show password"}
          style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
            border: 0, background: "transparent", cursor: "pointer", color: "#64748b", padding: 6 }}>
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      <div id={name + "-requirements"} style={{ marginTop: 12, padding: 14, borderRadius: 14, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700, color: "#334155" }}>
          <span>Password strength</span><span style={{ color }}>{label}</span>
        </div>
        <div aria-hidden="true" style={{ display: "flex", gap: 5, marginTop: 8, marginBottom: 12 }}>
          {[1,2,3].map((n) => <div key={n} style={{ height: 5, flex: 1, borderRadius: 8, background: n <= level ? color : "#e2e8f0", transition: "background .2s" }} />)}
        </div>
        <div style={{ display: "grid", gap: 7 }}>
          {checks.map((check) => <div key={check.label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: check.ok ? "#047857" : "#64748b" }}>
            {check.ok ? <Check size={14} /> : <X size={14} />}
            <span>{check.label}</span>
          </div>)}
        </div>
      </div>
    </div>
  );
}
