"use client";
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { fallbackCatalog, getPublicPlanCatalog, storePriceLabel, type CatalogPlan } from "@/lib/plan-catalog";
import { billingAvailability, manageSubscriptionUrl, purchaseOffer, restorePurchases, storeName, storeOffers, type StoreOffer } from "@/lib/native/billing";
import { hapticSuccess } from "@/lib/native/haptics";
import { runtime } from "@/lib/native/runtime";
import { trackConversion, type PaywallContext } from "@/lib/conversion";

function features(p: CatalogPlan) {
  // Only benefits the server enforces (reserve_scan): monthly allowance and PDF pages per scan.
  return [`${p.monthlyScans} AI scans every month`, `PDFs up to ${p.pdfPagesPerScan} pages`];
}

/** Plans and upgrades. Native apps buy through the App Store / Google Play; the server grants the plan. */
export default function PlansSheet({ onDone, context = "settings" }: { onDone: (message: string) => void; context?: PaywallContext }) {
  const [plans, setPlans] = useState<CatalogPlan[]>(fallbackCatalog().filter((p) => p.id === "free"));
  const [current, setCurrent] = useState<string>("free");
  const [userId, setUserId] = useState<string | null>(null);
  const [offers, setOffers] = useState<StoreOffer[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const availability = billingAvailability();

  useEffect(() => {
    getPublicPlanCatalog().then(setPlans).catch(() => undefined);
    if (!isSupabaseConfigured()) return;
    const db = createClient();
    db.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      setUserId(data.user.id);
      const { data: profile } = await db.from("profiles").select("plan").eq("id", data.user.id).maybeSingle();
      if (profile?.plan) setCurrent(profile.plan);
      if (availability === "store") storeOffers(data.user.id).then(setOffers).catch(() => setError(`Plans couldn't be loaded from ${storeName()}. Check your connection.`));
    });
  }, [availability]);

  async function buy(offer: StoreOffer) {
    if (!userId) return;
    setBusy(offer.id);
    setError("");
    if (offer.period === "monthly") trackConversion("monthly_plan_selected", context);
    if (offer.period === "annual") trackConversion("annual_plan_selected", context);
    trackConversion("checkout_started", context);
    try {
      const out = await purchaseOffer(userId, offer.id);
      if (out.status === "cancelled") return trackConversion("checkout_cancelled", context);
      if (out.status === "pending") return onDone("Purchase pending — your plan updates as soon as the store confirms payment.");
      if (out.plan) setCurrent(out.plan);
      trackConversion("checkout_completed", context);
      // A new account that buys during the welcome screen has finished onboarding.
      if (context === "post_verification" && isSupabaseConfigured())
        await createClient().rpc("complete_premium_onboarding" as never, { p_choice: "paid" } as never).then(() => undefined, () => undefined);
      hapticSuccess();
      onDone("Subscription active. Thank you for supporting Zest Snap!");
    } catch (e) {
      trackConversion("checkout_failed", context);
      setError(e instanceof Error ? e.message : "The purchase didn't complete.");
    } finally {
      setBusy(null);
    }
  }

  async function restore() {
    if (!userId) return;
    setBusy("restore");
    setError("");
    try {
      const plan = await restorePurchases(userId);
      if (plan) setCurrent(plan);
      if (plan && plan !== "free") trackConversion("subscription_restored", context);
      onDone(plan && plan !== "free" ? "Purchases restored." : `No active ${storeName()} subscription was found for this account.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restore didn't complete. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const paid = plans.filter((p) => p.id !== "free");
  return (
    <div className="plansSheet">
      {plans.map((p) => {
        const planOffers = offers.filter((o) => o.plan === p.id);
        return (
          <section key={p.id} className={"planOption" + (p.id === current ? " current" : "")}>
            <div className="planOptionTop">
              <b>{p.name}</b>
              <span>{p.id === current ? "Your plan" : p.id === "free" ? "Free" : storePriceLabel(planOffers)}</span>
            </div>
            <ul>{features(p).map((f) => <li key={f}><Check size={15} aria-hidden="true" /> {f}</li>)}</ul>
            {p.id !== "free" && p.id !== current && planOffers.map((o) => (
              <button key={o.id} className="button" disabled={!!busy || !p.active} onClick={() => buy(o)}>
                {busy === o.id ? "Opening " + storeName() + "…" : `Subscribe · ${o.price}${o.period === "annual" ? "/year" : o.period === "monthly" ? "/month" : ""}`}
              </button>
            ))}
          </section>
        );
      })}
      {availability === "web_not_connected" && paid.length > 0 && <p className="plansNote">Paid plans aren&apos;t available to buy on the web yet. You&apos;ll be able to upgrade here as soon as they launch.</p>}
      {availability === "store_not_configured" && <p className="plansNote">Subscriptions open soon in the {storeName()} app.</p>}
      {availability === "store" && userId && (
        <>
          <button className="button alt" disabled={!!busy} onClick={restore}>{busy === "restore" ? "Restoring…" : runtime() === "ios" ? "Restore Purchases" : "Restore purchases"}</button>
          {current !== "free" && manageSubscriptionUrl() && (
            <a className="button alt" href={manageSubscriptionUrl()!} target="_blank" rel="noopener noreferrer">Manage subscription</a>
          )}
          <p className="plansNote">
            Subscriptions renew automatically until cancelled. Payment is charged to your {storeName()} account; manage or cancel any time in your
            {runtime() === "ios" ? " Apple ID subscriptions" : " Google Play subscriptions"}. <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a>
          </p>
        </>
      )}
      {availability === "store" && !userId && <p className="plansNote">Sign in to subscribe, so your plan stays with your account on every device.</p>}
      {error && <p className="supportFormError" role="alert">{error}</p>}
    </div>
  );
}
