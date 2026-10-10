"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Camera, Check, Clock3, Cloud, MapPin, Sparkles } from "lucide-react";
import PlansSheet from "@/app/settings/plans-sheet";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { getDataProvider, type Usage } from "@/lib/data";
import { getPublicPlanCatalog, type CatalogPlan } from "@/lib/plan-catalog";
import { trackConversion, type PaywallContext } from "@/lib/conversion";
import { billingAvailability, manageSubscriptionUrl, purchaseOffer, restorePurchases, storeName, storeOffers, type StoreOffer } from "@/lib/native/billing";
import { annualSavingsPercent, billingTerms, cardPrice, pickProOffers, type PaidPlanId } from "@/lib/billing/paywall";
import { hapticSuccess } from "@/lib/native/haptics";

type From = "onboarding" | "guest" | "free_limit" | "settings";
type Period = "annual" | "monthly";
const contextOf: Record<From, PaywallContext> = { onboarding: "post_verification", guest: "guest_limit", free_limit: "free_limit", settings: "settings" };

/**
 * Premium page. Prices, purchases and restores go through the App Store / Google Play via RevenueCat
 * (lib/native/billing). The device only starts a purchase; the server grants Pro from the verified receipt.
 * Nothing on this page shows a price the store didn't provide.
 * Contexts: ?from=onboarding (once, after a new account verifies), guest, free_limit, settings. ?plan=monthly preselects Monthly.
 */
export default function UpgradePage() {
  const router = useRouter();
  const [from, setFrom] = useState<From>("settings");
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [currentPlan, setCurrentPlan] = useState("free");
  const [usage, setUsage] = useState<Usage | null>(null);
  const [catalog, setCatalog] = useState<CatalogPlan[]>([]);
  const [freeScans, setFreeScans] = useState(3);
  const [offers, setOffers] = useState<StoreOffer[]>([]);
  const [offersState, setOffersState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [period, setPeriod] = useState<Period>("annual");
  const [busy, setBusy] = useState<"buy" | "restore" | "free" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [eventDate, setEventDate] = useState("12 Oct 2026");
  const [availability, setAvailability] = useState<ReturnType<typeof billingAvailability>>("web_not_connected");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const f = params.get("from");
    const next: From = f === "onboarding" || f === "guest" || f === "free_limit" ? f : "settings";
    setFrom(next);
    if (params.get("plan") === "monthly") setPeriod("monthly");
    const avail = billingAvailability();
    setAvailability(avail);
    // A date just ahead of today, so the illustration never looks stale.
    setEventDate(new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(Date.now() + 2 * 864e5));
    trackConversion(next === "onboarding" ? "verified_paywall_viewed" : next === "guest" ? "guest_paywall_viewed" : "premium_plan_viewed", contextOf[next]);
    getPublicPlanCatalog()
      .then((plans) => {
        setCatalog(plans);
        const free = plans.find((p) => p.id === "free");
        if (free) setFreeScans(free.monthlyScans);
      })
      .catch(() => undefined);

    const loadOffers = (uid: string | null) => {
      if (avail !== "store") return;
      setOffersState("loading");
      storeOffers(uid)
        .then((o) => {
          setOffers(o);
          setOffersState("ready");
        })
        .catch(() => setOffersState("error"));
    };
    if (!isSupabaseConfigured()) {
      setSignedIn(false);
      return loadOffers(null);
    }
    const db = createClient();
    db.auth
      .getSession()
      .then(async ({ data }) => {
        const user = data.session?.user ?? null;
        setSignedIn(Boolean(user));
        setUserId(user?.id ?? null);
        loadOffers(user?.id ?? null);
        if (!user) return;
        const { data: profile } = await db.from("profiles").select("plan").eq("id", user.id).maybeSingle();
        if (profile?.plan) setCurrentPlan(profile.plan);
        if (next === "free_limit") setUsage(await (await getDataProvider()).loadUsage());
      })
      .catch(() => {
        setSignedIn(false);
        loadOffers(null);
      });
  }, []);

  const recommended = useMemo(() => (catalog.find((p) => p.id !== "free" && p.recommended)?.id ?? null) as PaidPlanId | null, [catalog]);
  const pro = useMemo(() => pickProOffers(offers, recommended), [offers, recommended]);
  const proCatalog = catalog.find((p) => p.id === (pro.plan ?? recommended));
  const selected = period === "annual" ? pro.annual : pro.monthly;
  const savings = annualSavingsPercent(pro.annual, pro.monthly);
  const isPaid = currentPlan !== "free";
  // The server only grants a plan that is active in plan_rules; never let someone pay for one it would refuse.
  const planOpen = proCatalog ? proCatalog.active : true;
  const otherTiers = signedIn && offers.some((o) => pro.plan && o.plan !== pro.plan);

  const store = availability === "store";
  const unavailableNote =
    availability === "web_not_connected"
      ? "Pro is available in the Zest Snap app for iPhone and Android."
      : availability === "store_not_configured" || !planOpen || (offersState === "ready" && !pro.plan)
        ? `Pro opens soon in the ${storeName()} app.`
        : offersState === "error"
          ? `Prices couldn’t be loaded from ${storeName()}. Check your connection and try again.`
          : "";

  const nextPath = `/upgrade?from=${from}${period === "monthly" ? "&plan=monthly" : ""}`;

  async function continueWithPro() {
    setError("");
    setMessage("");
    if (isPaid) {
      const url = manageSubscriptionUrl();
      if (url) window.open(url, "_blank", "noopener,noreferrer");
      else router.push("/app");
      return;
    }
    if (!signedIn) {
      // Plans belong to an account (so they work on every device): sign up first, then come straight back here.
      trackConversion("free_registration_started", contextOf[from]);
      router.push("/login?mode=signup&next=" + encodeURIComponent(nextPath));
      return;
    }
    if (!store || !selected || !userId || !planOpen) {
      setError(unavailableNote || "Pro isn’t available right now.");
      return;
    }
    setBusy("buy");
    trackConversion(period === "annual" ? "annual_plan_selected" : "monthly_plan_selected", contextOf[from]);
    trackConversion("checkout_started", contextOf[from]);
    try {
      const out = await purchaseOffer(userId, selected.id);
      if (out.status === "cancelled") return trackConversion("checkout_cancelled", contextOf[from]);
      if (out.status === "pending") return setMessage("Purchase pending — Pro switches on as soon as the store confirms payment.");
      // Pro is only shown as active once the server has verified the store receipt and granted the plan.
      if (!out.plan || out.plan === "free") return setError("We couldn’t confirm your subscription yet. Try Restore Purchases in a moment.");
      setCurrentPlan(out.plan);
      trackConversion("checkout_completed", contextOf[from]);
      if (from === "onboarding")
        await createClient()
          .rpc("complete_premium_onboarding" as never, { p_choice: "paid" } as never)
          .then(
            () => undefined,
            () => undefined,
          );
      hapticSuccess();
      setMessage("Welcome to Pro! Your subscription is active.");
    } catch (e) {
      trackConversion("checkout_failed", contextOf[from]);
      setError(e instanceof Error ? e.message : "The purchase didn’t complete. You haven’t been charged.");
    } finally {
      setBusy(null);
    }
  }

  async function restore() {
    setError("");
    setMessage("");
    if (!signedIn || !userId) return router.push("/login?next=" + encodeURIComponent(nextPath));
    if (!store) return setMessage("Restore Purchases works in the Zest Snap app on the device you subscribed with.");
    setBusy("restore");
    try {
      const plan = await restorePurchases(userId);
      if (plan) setCurrentPlan(plan);
      if (plan && plan !== "free") trackConversion("subscription_restored", contextOf[from]);
      setMessage(plan && plan !== "free" ? "Purchases restored. Pro is active." : `No active ${storeName()} subscription was found for this account.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restore didn’t complete. Try again.");
    } finally {
      setBusy(null);
    }
  }

  /** Free is always one tap away. For the one-time introduction the choice is stored on the server. */
  async function continueFree(choice: "free" | "dismissed" = "free") {
    setBusy("free");
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
      ? "Ready for more? Create a free account or go Pro — everything you’ve scanned stays with you."
      : from === "free_limit"
        ? "Your Planner, reminders and saved scans are all still here. Go Pro for more AI scans, or wait for next month’s allowance."
        : "Turn photos, documents and ideas into plans you’ll never forget.";

  const features = [
    {
      title: "More AI scans",
      detail: proCatalog && proCatalog.id !== "free" ? `Up to ${proCatalog.monthlyScans} scans a month, PDFs up to ${proCatalog.pdfPagesPerScan} pages.` : "Capture and organise everything that matters.",
      Icon: Camera,
      tone: "mint",
    },
    { title: "Smart reminders", detail: "Never miss important dates again.", Icon: CalendarDays, tone: "blue" },
    { title: "Plan with Zest AI", detail: "Turn your thoughts into a clear plan.", Icon: Sparkles, tone: "violet" },
    { title: "Sync everywhere", detail: "Access your plans on all your devices.", Icon: Cloud, tone: "mint" },
  ] as const;

  const priceSlot = (offer: StoreOffer | null) => {
    const p = cardPrice(offer);
    if (p) {
      return (
        <span className="pwPrice">
          <b>{p.main}</b>
          <span className="pwPriceUnit">{p.unit}</span>
          {p.sub && <small>{p.sub}</small>}
        </span>
      );
    }
    if (store && (offersState === "loading" || offersState === "idle"))
      return (
        <span className="pwPrice" aria-label="Loading price">
          <span className="pwSkeleton wide" />
          <span className="pwSkeleton" />
        </span>
      );
    return (
      <span className="pwPrice">
        <span className="pwPriceNote">{availability === "web_not_connected" ? "Price in app" : "Coming soon"}</span>
      </span>
    );
  };

  const plans: { id: Period; title: string; detail: string; offer: StoreOffer | null }[] = [
    { id: "annual", title: "Pro – Annual", detail: "All premium features. Billed yearly.", offer: pro.annual },
    { id: "monthly", title: "Pro – Monthly", detail: "All premium features. Billed monthly.", offer: pro.monthly },
  ];

  const ctaDisabled =
    busy !== null || (signedIn === true && !isPaid && (!store || !planOpen || !selected));
  const ctaLabel = isPaid
    ? manageSubscriptionUrl()
      ? "Manage subscription"
      : "Go to my Planner"
    : busy === "buy"
      ? `Opening ${storeName()}…`
      : "Continue with Pro";

  return (
    <main className="pw">
      <div className="pwFrame">
        <PaywallArt date={eventDate} />

        <header className="pwTop">
          <Link href="/app" className="pwBrand" aria-label="Zest Snap home">
            Zest <span>Snap</span>
          </Link>
          {from === "onboarding" ? (
            <button type="button" className="pwSkip" onClick={() => continueFree("dismissed")} disabled={busy !== null}>
              Skip for now
            </button>
          ) : (
            <Link href="/app" className="pwSkip">
              <ArrowLeft size={15} aria-hidden="true" /> Back
            </Link>
          )}
        </header>

        <section className="pwHero" aria-labelledby="upgrade-title">
          <h1 id="upgrade-title">{heading}</h1>
          <p className="pwLead">{lead}</p>
          {usage && (
            <div className="pwUsage" role="status">
              <b>
                {Math.min(usage.scans, usage.allowance)} of {usage.allowance}
              </b>{" "}
              free AI scans used this month · {Math.max(0, usage.allowance - usage.scans)} left
            </div>
          )}
        </section>

        <ul className="pwFeatures" aria-label="What you get with Pro">
          {features.map(({ title, detail, Icon, tone }) => (
            <li key={title}>
              <span className={"pwIcon " + tone}>
                <Icon aria-hidden="true" strokeWidth={2.1} />
              </span>
              <span className="pwFeatureText">
                <b>{title}</b>
                <small>{detail}</small>
              </span>
            </li>
          ))}
        </ul>

        <div className="pwPlans" role="radiogroup" aria-label="Choose your Pro plan">
          {plans.map((p) => {
            const on = period === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={on}
                className={"pwPlan" + (on ? " selected" : "") + (p.id === "annual" ? " annual" : "")}
                onClick={() => setPeriod(p.id)}
                disabled={busy !== null}
              >
                <span className="pwPlanMain">
                  {p.id === "annual" && <span className="pwBadge">{savings ? `Best value · Save ${savings}%` : "Best value"}</span>}
                  <b className="pwPlanTitle">{p.title}</b>
                  <span className="pwPlanDetail">{p.detail}</span>
                </span>
                <span className="pwPlanSide">
                  <span className={"pwRadio" + (on ? " on" : "")} aria-hidden="true">
                    {on && <Check size={13} strokeWidth={3.2} />}
                  </span>
                  {priceSlot(p.offer)}
                </span>
              </button>
            );
          })}
        </div>

        {isPaid && (
          <p className="pwCurrent" role="status">
            You’re on Pro. Thank you for supporting Zest Snap!
          </p>
        )}

        <button type="button" className="pwCta" onClick={continueWithPro} disabled={ctaDisabled}>
          <span>{ctaLabel}</span>
          {!busy && !isPaid && <ArrowRight size={22} strokeWidth={2.2} aria-hidden="true" />}
        </button>
        {signedIn && !isPaid && unavailableNote && (
          <p className="pwNotice" role="note">
            {unavailableNote}
          </p>
        )}

        {signedIn === false ? (
          <Link
            className="pwFree"
            href={"/login?mode=signup&next=" + encodeURIComponent(nextPath)}
            onClick={() => trackConversion("free_registration_started", contextOf[from])}
          >
            Create a free account
          </Link>
        ) : (
          <button type="button" className="pwFree" disabled={busy !== null} onClick={() => continueFree("free")}>
            {from === "free_limit" ? "Back to my Planner" : isPaid ? "Go to my Planner" : "Continue with Free plan"}
          </button>
        )}
        <p className="pwFine">
          {signedIn === false ? (
            <>
              Get {freeScans} free scans every month. No payment required.{" "}
              <Link href={"/login?next=" + encodeURIComponent(nextPath)}>I already have an account</Link>
            </>
          ) : from === "free_limit" ? (
            "Your free allowance resets next month."
          ) : (
            `Get ${freeScans} free scans to try Zest Snap. No payment required.`
          )}
        </p>

        {(message || error) && (
          <p className={error ? "pwAlert" : "pwSuccess"} role={error ? "alert" : "status"}>
            {error || message}
          </p>
        )}

        {store && !isPaid && <p className="pwTerms">{billingTerms(selected, storeName())}</p>}

        {otherTiers && (
          <details className="pwAllPlans">
            <summary>Need more scans? See all plans</summary>
            <PlansSheet context={contextOf[from]} onDone={setMessage} />
          </details>
        )}

        <footer className="pwFooter">
          <Link href="/terms">Terms of Service</Link>
          <span aria-hidden="true">|</span>
          <Link href="/privacy">Privacy Policy</Link>
          <span aria-hidden="true">|</span>
          <button type="button" onClick={restore} disabled={busy !== null}>
            {busy === "restore" ? "Restoring…" : "Restore Purchases"}
          </button>
        </footer>
      </div>
    </main>
  );
}

/** Decorative scene (plant, notebook, phone with a planned event, meeting notes). Drawn in CSS so it stays crisp and themeable. */
function PaywallArt({ date }: { date: string }) {
  return (
    <div className="pwArt" aria-hidden="true">
      <div className="pwNotebook">
        <span className="rings" />
      </div>
      <svg className="pwPlant" viewBox="0 0 120 80">
        <ellipse cx="60" cy="74" rx="30" ry="7" className="pot" />
        <path d="M60 70 C40 52 18 50 6 56 C22 40 46 44 60 70Z" className="leaf a" />
        <path d="M60 70 C52 44 36 28 22 22 C46 22 62 42 60 70Z" className="leaf b" />
        <path d="M60 70 C62 40 72 20 88 10 C86 36 74 56 60 70Z" className="leaf c" />
        <path d="M60 70 C76 50 96 44 116 46 C100 62 80 68 60 70Z" className="leaf a" />
        <path d="M60 70 C64 50 82 34 104 28 C94 48 78 62 60 70Z" className="leaf b" />
      </svg>
      <div className="pwPhone">
        <div className="pwScreen">
          <div className="pwStatus">
            <span>9:41</span>
            <span className="island" />
            <span className="bars" />
          </div>
          <p className="pwEventTitle">
            Coffee
            <br />
            with Sarah
          </p>
          <p className="pwEventRow">
            <CalendarDays /> {date}
          </p>
          <p className="pwEventRow">
            <Clock3 /> 10:00
          </p>
          <p className="pwEventRow">
            <MapPin /> The Glass House
          </p>
          <span className="pwScreenGlow" />
        </div>
      </div>
      <div className="pwNotes">
        <b>
          Meeting
          <br />
          Notes
        </b>
        <i />
        <i />
        <i />
        <i />
      </div>
    </div>
  );
}
