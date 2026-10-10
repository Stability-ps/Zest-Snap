import { adminRpc, iso } from "@/lib/admin/server";
import { fmtPercent, humanize, ratio } from "@/lib/admin/format";
import { BarList, Card, LoadError, PageHeader, Stats } from "../../_components/ui";
import { readParams, rangeFrom, type SearchParams } from "../../_components/page-utils";
import { AnalyticsTabs } from "../tabs";

export const metadata = { title: "Conversion" };

const n = (v: unknown) => Number(v || 0);

/**
 * Guest → account → paid funnel. Scans, registrations, verification and subscriptions come from their own
 * tables; paywall views, plan choices and checkout steps from conversion_events (distinct pseudonymous subjects).
 */
export default async function Conversion({ searchParams }: { searchParams: SearchParams }) {
  const range = rangeFrom(await readParams(searchParams));
  const res = await adminRpc<any>("admin_conversion_funnel", { p_from: iso(range.from), p_to: iso(range.to) });
  const head = <><PageHeader title="Analytics" description={`Guest to paid conversion · ${range.label}`} /><AnalyticsTabs current="conversion" range={range} /></>;
  if (res.error) return <>{head}<Card><LoadError error={res.error} retryHref="/admin/analytics/conversion" /></Card></>;
  const f = res.data;
  const e = (k: string) => n(f.events?.[k]);
  const funnel = [
    { key: "g1", label: "Guest devices with a successful scan", value: n(f.guest_scan_1_completed) },
    { key: "g2", label: "…with 2 scans", value: n(f.guest_scan_2_completed) },
    { key: "g3", label: "…with 3 scans (trial used)", value: n(f.guest_scan_3_completed) },
    { key: "gp", label: "Saw the guest paywall", value: e("guest_paywall_viewed") },
    { key: "fr", label: "Started a free account", value: e("free_registration_started") },
    { key: "rc", label: "Registered", value: n(f.registration_completed) },
    { key: "ev", label: "Verified their email", value: n(f.email_verified) },
    { key: "vp", label: "Saw the welcome premium screen", value: e("verified_paywall_viewed") },
    { key: "cs", label: "Started checkout", value: e("checkout_started") },
    { key: "cc", label: "Completed checkout", value: e("checkout_completed") },
  ];
  return (
    <>
      {head}
      <Card title="Funnel" description="Distinct devices or accounts at each step in this period.">
        <BarList data={funnel} />
      </Card>
      <div className="zadm-grid zadm-grid-2">
        <Card title="Conversion rates">
          <Stats items={[
            { label: "Guest trial → registered", value: fmtPercent(ratio(f.guest_devices_registered, f.guest_scan_1_completed)) },
            { label: "Email verification", value: fmtPercent(ratio(f.email_verified, f.registration_completed)) },
            { label: "Welcome screen → paid", value: fmtPercent(ratio(f.onboarding_paid, f.onboarding_shown_eligible)) },
            { label: "Checkout completion", value: fmtPercent(ratio(e("checkout_completed"), e("checkout_started"))) },
            { label: "Registered → paid", value: fmtPercent(ratio(f.subscription_activated, f.registration_completed)) },
            { label: "Chose Free on welcome", value: n(f.onboarding_free) },
          ]} />
        </Card>
        <Card title="Plans and checkout">
          <Stats items={[
            { label: "Monthly selected", value: e("monthly_plan_selected") },
            { label: "Annual selected", value: e("annual_plan_selected") },
            { label: "Checkout cancelled", value: e("checkout_cancelled") },
            { label: "Checkout failed", value: e("checkout_failed") },
            { label: "Restored", value: e("subscription_restored") },
            { label: "Free limit reached", value: e("free_limit_reached") },
          ]} />
        </Card>
        <Card title="Paid subscriptions by plan"><BarList data={Object.entries(f.paid_by_plan || {}).map(([k, v]) => ({ key: k, label: humanize(k), value: n(v) }))} empty="No paid subscriptions in this period." /></Card>
        <Card title="By platform (events)"><BarList data={Object.entries(f.events_by_platform || {}).map(([k, v]) => ({ key: k, label: humanize(k.replace(":", " · ")), value: n(v) }))} empty="No funnel events in this period." /></Card>
      </div>
    </>
  );
}
