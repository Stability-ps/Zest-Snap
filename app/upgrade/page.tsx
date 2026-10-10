"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, BellRing, CalendarDays, Camera, Check, Clock, Cloud, MapPin, Sparkles } from "lucide-react";
import ProPicker from "./pro-picker";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { getDataProvider, type Usage } from "@/lib/data";
import { getPublicPlanCatalog, type CatalogPlan } from "@/lib/plan-catalog";
import { trackConversion, type PaywallContext } from "@/lib/conversion";
import { holdLightAppearance } from "@/lib/appearance/client";

type From = "onboarding" | "guest" | "free_limit" | "settings";
const contextOf: Record<From, PaywallContext> = { onboarding: "post_verification", guest: "guest_limit", free_limit: "free_limit", settings: "settings" };

/**
 * Premium page, as approved in Figma ("Premium onboarding — approved", 4:2). Always light, like Admin
 * (lib/appearance/boot.ts). Prices come only from the App Store / Google Play (ProPicker); where buying isn't
 * possible the page says so instead of showing a price.
 * Contexts: ?from=onboarding (once, after a new account verifies), guest, free_limit, settings.
 */
export default function UpgradePage() {
  const [from, setFrom] = useState<From>("settings");
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [best, setBest] = useState<CatalogPlan | null>(null);
  const [freeScans, setFreeScans] = useState(3);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => holdLightAppearance(), []);

  useEffect(() => {
    const f = new URLSearchParams(window.location.search).get("from");
    const next: From = f === "onboarding" || f === "guest" || f === "free_limit" ? f : "settings";
    setFrom(next);
    trackConversion(next === "onboarding" ? "verified_paywall_viewed" : next === "guest" ? "guest_paywall_viewed" : "premium_plan_viewed", contextOf[next]);
    getPublicPlanCatalog()
      .then((plans) => {
        // Describe the recommended plan (not the largest), so the copy matches what most people would buy.
        const paid = plans.filter((p) => p.id !== "free");
        setBest(paid.find((p) => p.recommended) ?? paid.sort((a, b) => a.monthlyScans - b.monthlyScans)[0] ?? null);
        const free = plans.find((p) => p.id === "free");
        if (free) setFreeScans(free.monthlyScans);
      })
      .catch(() => undefined);
    if (!isSupabaseConfigured()) return setSignedIn(false);
    createClient()
      .auth.getSession()
      .then(async ({ data }) => {
        setSignedIn(Boolean(data.session));
        if (data.session && next === "free_limit") setUsage(await (await getDataProvider()).loadUsage());
      })
      .catch(() => setSignedIn(false));
  }, []);

  /** Free is always one tap away. For the one-time introduction the choice is stored on the server. */
  async function continueFree(choice: "free" | "dismissed" = "free") {
    setBusy(true);
    try {
      if (from === "onboarding" && signedIn) {
        trackConversion("free_plan_selected", "post_verification");
        const { error } = await createClient().rpc("complete_premium_onboarding" as never, { p_choice: choice } as never);
        if (error) console.error("onboarding_complete_failed", error.code);
      }
    } catch {
      // Never keep someone out of the app because the onboarding record couldn't be written.
    } finally {
      window.location.assign(from === "free_limit" ? "/app?view=planner" : "/app");
    }
  }

  const heading =
    from === "guest" ? "You’ve captured 3 important moments." : from === "free_limit" ? "You’ve used this month’s scans." : "Get more from Zest Snap.";
  const lead =
    from === "guest"
      ? "Ready for more? Create a free account or choose a plan — everything you’ve scanned stays with you."
      : from === "free_limit"
        ? "Your Planner, reminders and saved scans are all still here. Upgrade for more AI scans, or wait for next month’s allowance."
        : "Turn photos, documents and ideas into plans you’ll never forget.";

  // Only what the app actually provides (scan allowances are server-enforced).
  const benefits = [
    { title: "More AI scans", detail: best ? `Up to ${best.monthlyScans} scans each month. Capture everything that matters.` : "Capture and organise everything that matters.", Icon: Camera },
    { title: "Smart reminders", detail: "Never miss important dates again.", Icon: BellRing },
    { title: "Plan with Zest AI", detail: "Turn your thoughts into a clear plan.", Icon: Sparkles },
    { title: "Sync everywhere", detail: "Access your plans on all your devices.", Icon: Cloud },
  ];

  return (
    <main className="upgradePage">
      <div className="upgradeWrap">
        <header className="upgradeTop">
          <Link href="/app" className="brand" aria-label="Zest Snap home">
            Zest <span>Snap</span>
          </Link>
          {from === "onboarding" ? (
            <button type="button" className="textButton" onClick={() => continueFree("dismissed")} disabled={busy}>
              Skip for now
            </button>
          ) : (
            <Link href="/app" className="textButton">
              <ArrowLeft size={16} aria-hidden="true" /> Back
            </Link>
          )}
        </header>

        <section aria-labelledby="upgrade-title">
          <h1 id="upgrade-title">{heading}</h1>
          <p className="upgradeLead">{lead}</p>
          {usage && (
            <div className="upgradeUsage" role="status">
              <b>
                {Math.min(usage.scans, usage.allowance)} of {usage.allowance}
              </b>{" "}
              free AI scans used this month · {Math.max(0, usage.allowance - usage.scans)} left
            </div>
          )}
        </section>

        <figure className="premiumHero" aria-label="Example: a plan Zest Snap made from a photo">
          <span className="premiumHeroEyebrow">✦ Your next plan</span>
          <b>Coffee with Sarah</b>
          <span className="premiumHeroMeta">
            <span><CalendarDays aria-hidden="true" /> 12 Oct 2026</span>
            <span><Clock aria-hidden="true" /> 10:00</span>
          </span>
          <span className="premiumHeroMeta">
            <span><MapPin aria-hidden="true" /> The Glass House</span>
          </span>
        </figure>

        <ul className="premiumBenefits" aria-label="What Pro adds">
          {benefits.map(({ title, detail, Icon }) => (
            <li key={title}>
              <span className="premiumBenefitIcon"><Icon aria-hidden="true" /></span>
              <span><b>{title}</b><small>{detail}</small></span>
            </li>
          ))}
        </ul>

        <section className="premiumPlans" aria-label="Choose your plan">
          {signedIn === false ? (
            <div className="upgradeSignup">
              <p>Create a free account to choose a plan. No payment required.</p>
              <Link
                className="proContinue"
                href={"/login?mode=signup&next=" + encodeURIComponent("/upgrade?from=" + from)}
                onClick={() => trackConversion("free_registration_started", contextOf[from])}
              >
                <Check size={18} aria-hidden="true" /> Create a free account — get {freeScans} more scans
              </Link>
              <Link className="proSecondary" href={"/login?next=" + encodeURIComponent("/upgrade?from=" + from)}>
                I already have an account
              </Link>
            </div>
          ) : (
            <ProPicker pro={best} context={contextOf[from]} onDone={setMessage} />
          )}
          {message && (
            <p className="upgradeMessage" role="status">
              {message}
            </p>
          )}
        </section>

        {signedIn && (
          <div className="upgradeFree">
            <button type="button" className="proSecondary" disabled={busy} onClick={() => continueFree("free")}>
              {busy ? "Opening Zest Snap…" : from === "free_limit" ? "Back to my Planner" : "Continue with Free plan"}
            </button>
            {from !== "free_limit" && <small>{freeScans} free AI scans every month. No payment required.</small>}
          </div>
        )}

        <footer className="upgradeFooter">
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
        </footer>
      </div>
    </main>
  );
}
