"use client";
import { useEffect, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { CatalogPlan } from "@/lib/plan-catalog";
import { billingAvailability, manageSubscriptionUrl, purchaseOffer, restorePurchases, storeName, storeOffers, type StoreOffer } from "@/lib/native/billing";
import { annualSavingPercent, proOffers } from "@/lib/premium-offer";
import { hapticSuccess } from "@/lib/native/haptics";
import { runtime } from "@/lib/native/runtime";
import { trackConversion, type PaywallContext } from "@/lib/conversion";

type Period = "annual" | "monthly";

/**
 * The premium page's plan choice (Figma "Premium onboarding — approved", 4:2): Pro as an annual or a monthly
 * App Store / Google Play subscription. Prices are only ever the store's own. Buying happens in the store and
 * the server grants the plan (/api/billing/sync); nothing here unlocks Pro by itself.
 */
export default function ProPicker({ pro, context, onDone }: { pro: CatalogPlan | null; context: PaywallContext; onDone: (message: string) => void }) {
  const availability = billingAvailability();
  const [userId, setUserId] = useState<string | null>(null);
  const [current, setCurrent] = useState("free");
  const [offers, setOffers] = useState<StoreOffer[] | null>(availability === "store" ? null : []);
  const [period, setPeriod] = useState<Period>("annual");
  const [busy, setBusy] = useState<"buy" | "restore" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const db = createClient();
    db.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      setUserId(data.user.id);
      const { data: profile } = await db.from("profiles").select("plan").eq("id", data.user.id).maybeSingle();
      if (profile?.plan) setCurrent(profile.plan);
      if (availability === "store")
        storeOffers(data.user.id)
          .then(setOffers)
          .catch(() => {
            setOffers([]);
            setError(`Prices couldn't be loaded from ${storeName()}. Check your connection and try again.`);
          });
    });
  }, [availability]);

  const { annual, monthly } = proOffers(offers ?? [], pro?.id ?? "");
  const saving = annualSavingPercent(annual, monthly);
  const selected = period === "annual" ? annual : monthly;
  const loading = availability === "store" && offers === null;
  const subscribed = current !== "free";
  const canBuy = availability === "store" && !!userId && !!selected && !!pro?.active && !subscribed;

  // Default to whichever period the store actually offers.
  useEffect(() => {
    if (offers && !annual && monthly) setPeriod("monthly");
  }, [offers, annual, monthly]);

  async function buy() {
    if (!userId || !selected) return;
    setBusy("buy");
    setError("");
    trackConversion(selected.period === "annual" ? "annual_plan_selected" : "monthly_plan_selected", context);
    trackConversion("checkout_started", context);
    try {
      const out = await purchaseOffer(userId, selected.id);
      if (out.status === "cancelled") return trackConversion("checkout_cancelled", context);
      if (out.status === "pending") return onDone("Purchase pending — your plan updates as soon as the store confirms payment.");
      if (out.plan) setCurrent(out.plan);
      trackConversion("checkout_completed", context);
      if (context === "post_verification")
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

  const card = (p: Period, offer: StoreOffer | null) => {
    const on = period === p;
    const price = offer ? `${offer.price}${p === "annual" ? "/year" : "/month"}` : loading ? "Loading price…" : null;
    return (
      <button
        key={p}
        type="button"
        role="radio"
        aria-checked={on}
        className={"proPlan" + (on ? " selected" : "")}
        disabled={!!busy || subscribed}
        onClick={() => setPeriod(p)}
      >
        {p === "annual" && saving !== null && <span className="proPlanBadge">Best value · save {saving}%</span>}
        <span className="proPlanTop">
          <b>Pro – {p === "annual" ? "Annual" : "Monthly"}</b>
          {price && <span className="proPlanPrice">{price}</span>}
          <span className="proPlanCheck" aria-hidden="true">{on && <Check size={14} />}</span>
        </span>
        <small>All premium features. Billed {p === "annual" ? "yearly" : "monthly"}.</small>
      </button>
    );
  };

  const unavailable =
    availability === "web_not_connected"
      ? "Pro can't be bought on the web yet."
      : availability === "store_not_configured"
        ? `Subscriptions open soon in the ${storeName()} app.`
        : !loading && !error && !subscribed && !selected
          ? `This plan isn't available in ${storeName()} right now.`
          : "";

  return (
    <div className="proPicker">
      {subscribed ? (
        <p className="proCurrent" role="status">
          You&apos;re on {pro && current === pro.id ? "Pro" : "a paid plan"}. Thank you for supporting Zest Snap!
        </p>
      ) : (
        <div className="proPlans" role="radiogroup" aria-label="Pro billing period">
          {card("annual", annual)}
          {card("monthly", monthly)}
        </div>
      )}
      {!subscribed && (
        <button type="button" className="proContinue" disabled={!canBuy || !!busy} onClick={buy} aria-describedby={unavailable ? "pro-unavailable" : undefined}>
          {busy === "buy" ? `Opening ${storeName()}…` : "Continue with Pro"} <ArrowRight size={19} aria-hidden="true" />
        </button>
      )}
      {unavailable && <p id="pro-unavailable" className="proNote">{unavailable}</p>}
      {subscribed && manageSubscriptionUrl() && (
        <a className="proSecondary" href={manageSubscriptionUrl()!} target="_blank" rel="noopener noreferrer">Manage subscription</a>
      )}
      {availability === "store" && !subscribed && (
        <p className="proNote">
          Subscriptions renew automatically until cancelled. Payment is charged to your {storeName()} account; cancel any time in your
          {runtime() === "ios" ? " Apple ID" : " Google Play"} subscriptions.
        </p>
      )}
      {error && <p className="proError" role="alert">{error}</p>}
      {availability === "store" && userId && (
        <button type="button" className="proRestore" disabled={!!busy} onClick={restore}>
          {busy === "restore" ? "Restoring…" : "Restore Purchases"}
        </button>
      )}
    </div>
  );
}
