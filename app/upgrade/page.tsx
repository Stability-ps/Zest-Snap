"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Camera, CalendarDays, Cloud, Sparkles } from "lucide-react";
import PlansSheet from "@/app/settings/plans-sheet";

/**
 * Standalone premium destination. Reuses the existing store-backed purchase and
 * restore flows; it intentionally never invents prices or subscription trials.
 * This route is not automatically inserted into signup until the server-side
 * once-per-account onboarding gate has been implemented.
 */
export default function UpgradePage() {
  const [message, setMessage] = useState("");
  const benefits = [
    { title: "More AI scans", detail: "Capture the moments that matter.", Icon: Camera },
    { title: "Smart planning", detail: "Turn dates into useful plans.", Icon: CalendarDays },
    { title: "Plan with Zest", detail: "Organise ideas and reminders.", Icon: Sparkles },
    { title: "Sync everywhere", detail: "Keep your plans together.", Icon: Cloud },
  ];
  return (
    <main style={{ minHeight: "100dvh", background: "linear-gradient(155deg,#f4f9fc 0%,#ffffff 45%,#edf8f6 100%)", color: "#102b4e", padding: "max(24px,env(safe-area-inset-top)) 18px max(32px,env(safe-area-inset-bottom))" }}>
      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 38 }}>
          <Link href="/app" style={{ color: "#102b4e", fontSize: 22, fontWeight: 800, textDecoration: "none" }}>Zest <span style={{ color: "#13b9a7" }}>Snap</span></Link>
          <Link href="/app" style={{ color: "#50677d", fontSize: 14, textDecoration: "none" }}>Skip for now</Link>
        </header>
        <section aria-labelledby="upgrade-title">
          <p style={{ color: "#079f93", fontWeight: 700, letterSpacing: 2, fontSize: 12 }}>MAKE MORE OF EVERY DAY</p>
          <h1 id="upgrade-title" style={{ fontSize: "clamp(32px,9vw,46px)", lineHeight: 1.09, letterSpacing: "-.045em", margin: "12px 0 16px" }}>Get more from<br />Zest Snap.</h1>
          <p style={{ color: "#65778c", fontSize: 16, lineHeight: 1.6, marginBottom: 28 }}>Turn photos, documents and ideas into plans you’ll never forget.</p>
          <div style={{ display: "grid", gap: 18, marginBottom: 30 }}>
            {benefits.map(({ title, detail, Icon }) => (
              <div key={title} style={{ display: "flex", gap: 15, alignItems: "center" }}>
                <span style={{ width: 48, height: 48, borderRadius: 16, background: "#def5f0", display: "grid", placeItems: "center", flexShrink: 0 }}><Icon size={23} color="#119e95" aria-hidden /></span>
                <span><strong style={{ display: "block", fontSize: 16 }}>{title}</strong><span style={{ color: "#65778c", fontSize: 13 }}>{detail}</span></span>
              </div>
            ))}
          </div>
        </section>
        <section aria-label="Subscription options" style={{ border: "1px solid #d9e8eb", borderRadius: 24, background: "#ffffff", padding: 18, boxShadow: "0 12px 40px rgba(16,43,78,.06)" }}>
          <h2 style={{ fontSize: 19, margin: "0 0 12px" }}>Choose your plan</h2>
          <PlansSheet onDone={setMessage} />
          {message && <p role="status" style={{ color: "#087e74" }}>{message}</p>}
        </section>
        <Link href="/app" style={{ display: "block", textAlign: "center", marginTop: 16, padding: 16, background: "#eff4fa", color: "#1469aa", borderRadius: 18, fontWeight: 700, textDecoration: "none" }}>Continue with Free plan</Link>
        <p style={{ textAlign: "center", color: "#65778c", fontSize: 12, marginTop: 12 }}>No payment required to continue with Free.</p>
        <footer style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 26, fontSize: 12 }}>
          <Link href="/terms" style={{ color: "#65778c" }}>Terms of Service</Link>
          <Link href="/privacy" style={{ color: "#65778c" }}>Privacy Policy</Link>
          <Link href="/app" style={{ color: "#65778c" }}><ArrowLeft size={12} style={{ verticalAlign: "middle" }} /> Back to app</Link>
        </footer>
      </div>
    </main>
  );
}
