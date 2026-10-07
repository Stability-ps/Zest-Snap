import Link from "next/link";
import {
  Activity, AlertTriangle, BadgeDollarSign, CalendarDays, CheckCircle2, ListChecks, LifeBuoy, ScanLine, Share2, Sparkles, Star, TrendingUp, UserPlus, Users, Wallet,
} from "lucide-react";
import { adminRpc, getAdmin, iso } from "@/lib/admin/server";
import { fmtDate, fmtMoney, fmtNumber, fmtPercent, pctChange, ratio } from "@/lib/admin/format";
import { BarList, Card, Empty, Kpi, Kpis, LoadError, Notice, PageHeader, Stats } from "./_components/ui";
import { BarChart, LineChart } from "./_components/charts";
import { SERIES_COLORS } from "@/lib/admin/palette";
import { readParams, rangeFrom, rangeQuery, type SearchParams } from "./_components/page-utils";

type Money = Record<string, number> | null;
const money = (m: Money) => {
  const entries = Object.entries(m || {});
  if (!entries.length) return null;
  return entries.map(([c, v]) => fmtMoney(v, c)).join(" · ");
};

export default async function Overview({ searchParams }: { searchParams: SearchParams }) {
  const admin = await getAdmin();
  const params = await readParams(searchParams);
  const range = rangeFrom(params);
  const rq = rangeQuery(range);
  const header = (
    <PageHeader
      title={`Good ${new Date().getUTCHours() < 12 ? "morning" : new Date().getUTCHours() < 18 ? "afternoon" : "evening"}${admin.name ? `, ${admin.name.split(" ")[0]}` : ""}`}
      description={`Zest Snap at a glance · ${range.label}. Changes compare with the previous ${range.key === "today" ? "day" : "period of the same length"}.`}
      actions={<Link className="ad-btn" href="/admin/exports">Export data</Link>}
    />
  );
  if (!admin.schemaReady) return <>{header}<Card><LoadError error={{ code: "not_ready", message: "" }} /></Card></>;

  const [ov, ts, att] = await Promise.all([
    adminRpc("admin_overview", { p_from: iso(range.from), p_to: iso(range.to) }),
    adminRpc<any[]>("admin_timeseries", { p_from: iso(range.from), p_to: iso(range.to), p_bucket: range.bucket }),
    Promise.resolve({ data: null, error: null } as any),
  ]);
  if (ov.error) return <>{header}<Card><LoadError error={ov.error} retryHref="/admin" /></Card></>;
  const o = ov.data;
  const series = ts.data || [];
  const a = att.data || {};
  const connected = !!o.payments_connected;
  const mrr = money(o.mrr);
  const arr = o.mrr ? money(Object.fromEntries(Object.entries(o.mrr as Record<string, number>).map(([c, v]) => [c, v * 12]))) : null;

  const attention = [
    { n: a.tickets_urgent, label: "urgent / high-priority support tickets", href: "/admin/support?priority=urgent", tone: "bad" },
    { n: a.tickets_new, label: "new support tickets waiting for a first reply", href: "/admin/support?status=new", tone: "warn" },
    { n: a.reports_new, label: "new problem reports to triage", href: "/admin/reports?status=new", tone: "warn" },
    { n: a.low_ratings_7d, label: "ratings of 1–2★ in the last 7 days", href: "/admin/ratings?rating=1", tone: "warn" },
    { n: a.failed_scans_24h, label: `failed scans in the last 24h (of ${fmtNumber((a as any).scans_24h ?? 0)})`, href: "/admin/scans?status=failed&range=today", tone: "warn" },
    { n: a.stuck_scans, label: "scans stuck in processing for 10+ minutes", href: "/admin/health", tone: "bad" },
    { n: a.reminders_failed_24h, label: "reminder deliveries failed in 24h", href: "/admin/reminders", tone: "warn" },
    { n: a.reminders_overdue, label: "reminders overdue for delivery", href: "/admin/health", tone: "bad" },
    { n: a.feedback_new, label: "pieces of feedback not yet reviewed", href: "/admin/feedback?status=new", tone: "info" },
  ].filter((i) => Number(i.n) > 0);

  const totalScansPeriod = Number(o.scans_period);
  const successRate = ratio(totalScansPeriod - Number(o.scans_failed_period), totalScansPeriod);

  return (
    <>
      {header}

      <Card title="What needs attention today" description="Live — not affected by the date range."
        actions={<Link className="ad-btn ad-btn-sm" href="/admin/health">System health</Link>}>
        {attention.length ? (
          <div className="ad-list" style={{ margin: "-6px -18px -10px" }}>
            {attention.map((i) => (
              <Link key={i.label} href={i.href} className="ad-list-row">
                <AlertTriangle size={16} color={i.tone === "bad" ? "var(--ad-bad)" : i.tone === "warn" ? "var(--ad-warn)" : "var(--ad-info)"} aria-hidden />
                <b style={{ minWidth: 28, fontVariantNumeric: "tabular-nums" }}>{fmtNumber(i.n)}</b>
                <span className="grow">{i.label}</span>
                <span className="ad-sub">Open →</span>
              </Link>
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", gap: 10, alignItems: "center", color: "var(--ad-good)", fontWeight: 650 }}>
            <CheckCircle2 size={18} aria-hidden /> All clear — no open tickets, new reports or delivery failures.
          </div>
        )}
      </Card>

      <Kpis>
        <Kpi label="Registered users" icon={<Users aria-hidden />} value={Number(o.users_total)} delta={pctChange(o.users_total, o.users_total_prev)} href="/admin/users" />
        <Kpi label="Active today" icon={<Activity aria-hidden />} value={Number(o.active_today)} foot="Distinct people" href="/admin/activity" />
        <Kpi label="Active · 7 days" icon={<Activity aria-hidden />} value={Number(o.active_7d)} foot="WAU" href="/admin/activity" />
        <Kpi label="Active · 30 days" icon={<Activity aria-hidden />} value={Number(o.active_30d)} foot="MAU" href="/admin/activity" />
        <Kpi label={`New users · ${range.label.toLowerCase()}`} icon={<UserPlus aria-hidden />} value={Number(o.new_users)} delta={pctChange(o.new_users, o.new_users_prev)} href="/admin/analytics/growth" />
        <Kpi label="New today" icon={<UserPlus aria-hidden />} value={Number(o.new_users_today)} foot={`${fmtNumber(o.new_users_month)} this month`} />
        <Kpi label="Total AI scans" icon={<ScanLine aria-hidden />} value={Number(o.scans_total)} foot={`${fmtNumber(o.scans_today)} today · ${fmtNumber(o.scans_month)} this month`} href="/admin/scans" />
        <Kpi label={`Scans · ${range.label.toLowerCase()}`} icon={<ScanLine aria-hidden />} value={totalScansPeriod} delta={pctChange(o.scans_period, o.scans_prev)}
          foot={successRate === null ? undefined : `${fmtPercent(successRate)} succeeded`} href="/admin/scans" />
        <Kpi label="Planner items created" icon={<ListChecks aria-hidden />} value={Number(o.planner_period)} delta={pctChange(o.planner_period, o.planner_prev)} href="/admin/planner" />
        <Kpi label="To-dos completed" icon={<CheckCircle2 aria-hidden />} value={Number(o.todos_done_period)} delta={pctChange(o.todos_done_period, o.todos_done_prev)} href="/admin/planner" />
        <Kpi label="Reminders created" icon={<Activity aria-hidden />} value={Number(o.reminders_period)} delta={pctChange(o.reminders_period, o.reminders_prev)} href="/admin/reminders" />
        <Kpi label="Calendar connections" icon={<CalendarDays aria-hidden />} value={Number(o.calendar_connections)} foot={`${fmtNumber(o.calendar_saves_period)} calendar saves in period`} href="/admin/calendar" />
        <Kpi label="Current subscribers" icon={<BadgeDollarSign aria-hidden />} value={connected ? Number(o.subscribers) : null} unavailable="Payment data not connected" href="/admin/revenue/subscriptions" />
        <Kpi label="MRR" icon={<Wallet aria-hidden />} value={connected ? mrr || fmtMoney(0) : null} unavailable="Payment data not connected" href="/admin/revenue" />
        <Kpi label="Estimated ARR" icon={<TrendingUp aria-hidden />} value={connected ? arr || fmtMoney(0) : null} unavailable="Payment data not connected" foot={connected ? "MRR × 12" : undefined} href="/admin/revenue" />
        <Kpi label="Revenue this month" icon={<Wallet aria-hidden />} value={connected ? money(o.revenue_month) || fmtMoney(0) : null} unavailable="Payment data not connected" href="/admin/revenue" />
        <Kpi label="AI cost (period)" icon={<Sparkles aria-hidden />} value={Number(o.ai_cost_rows) > 0 ? fmtMoney(o.ai_cost_period) : null}
          unavailable="Not measured" foot={Number(o.ai_cost_rows) > 0 ? `${fmtNumber(o.ai_cost_rows)} priced requests` : "Set OpenAI rates to estimate cost"} href="/admin/ai" />
        <Kpi label="Scans per active user" icon={<ScanLine aria-hidden />}
          value={ratio(o.account_scans_period, o.active_period) === null ? null : fmtNumber(ratio(o.account_scans_period, o.active_period), 1)} unavailable="No active users yet" />
        <Kpi label="Free → paid conversion" icon={<TrendingUp aria-hidden />} value={connected ? fmtPercent(ratio(o.paid_profiles, o.users_total)) : null} unavailable="Payment data not connected" />
        <Kpi label="Referral conversion" icon={<Share2 aria-hidden />} value={Number(o.referrals_total) ? fmtPercent(ratio(o.referrals_qualified, o.referrals_total)) : null}
          unavailable="No referrals yet" foot={Number(o.referrals_total) ? `${fmtNumber(o.referrals_qualified)} of ${fmtNumber(o.referrals_total)} qualified` : undefined} href="/admin/referrals" />
        <Kpi label="Average rating" icon={<Star aria-hidden />} value={o.rating_avg === null ? null : `${Number(o.rating_avg).toFixed(2)} ★`}
          unavailable="No ratings yet" foot={`${fmtNumber(o.rating_count)} ratings`} href="/admin/ratings" />
        <Kpi label="Open support" icon={<LifeBuoy aria-hidden />} value={Number(a.tickets_open ?? 0)} foot={`${fmtNumber(a.reports_new ?? 0)} new reports`} href="/admin/support" />
      </Kpis>

      {o.activity_tracking_since === null ? (
        <Notice title="Activity tracking starts with this release">
          Active-user counts use real recorded signals: app opens (from today), AI scans, Planner activity and feedback. No historical app-open data exists before today, so earlier periods may undercount people who only browsed.
        </Notice>
      ) : (
        <Notice>Daily app-open tracking began {fmtDate(o.activity_tracking_since)}. No historical app-open data is available before that date; scans, Planner and feedback activity are counted from the start.</Notice>
      )}

      <div className="ad-grid ad-grid-2">
        <Card title="User growth" description={`New registrations per ${range.bucket}`} actions={<Link className="ad-btn ad-btn-sm" href={`/admin/analytics/growth${rq ? "?" + rq : ""}`}>Details</Link>}>
          {ts.error ? <LoadError error={ts.error} /> : <BarChart data={series} series={[{ key: "signups", label: "Sign-ups", color: SERIES_COLORS[0] }]} />}
        </Card>
        <Card title="Active users" description={`Distinct active people per ${range.bucket}`} actions={<Link className="ad-btn ad-btn-sm" href={`/admin/activity${rq ? "?" + rq : ""}`}>Details</Link>}>
          {ts.error ? <LoadError error={ts.error} /> : <LineChart data={series} series={[{ key: "active", label: "Active users", color: SERIES_COLORS[1] }]} />}
          <div style={{ marginTop: 12 }}><Stats items={[{ label: "DAU (today)", value: Number(o.active_today) }, { label: "WAU (7d)", value: Number(o.active_7d) }, { label: "MAU (30d)", value: Number(o.active_30d) }]} /></div>
        </Card>
        <Card title="Scan activity" description="Successful and failed AI scans (signed-in and guest)" actions={<Link className="ad-btn ad-btn-sm" href={`/admin/scans${rq ? "?" + rq : ""}`}>Scans</Link>}>
          {ts.error ? <LoadError error={ts.error} /> : (
            <BarChart data={series} series={[{ key: "scans_ok", label: "Successful", color: SERIES_COLORS[0] }, { key: "scans_failed", label: "Failed", color: SERIES_COLORS[2] }]} />
          )}
        </Card>
        <Card title="Revenue" description="MRR, new subscriptions and cancellations" actions={<Link className="ad-btn ad-btn-sm" href="/admin/revenue">Revenue</Link>}>
          {connected ? (
            <>
              <LineChart data={series} series={[{ key: "revenue", label: "Net revenue", color: SERIES_COLORS[0] }]} format={(n) => fmtMoney(n)} />
              <div style={{ marginTop: 12 }}><BarChart height={140} data={series} series={[{ key: "new_subs", label: "New subscriptions", color: SERIES_COLORS[1] }, { key: "cancellations", label: "Cancellations", color: SERIES_COLORS[2] }]} /></div>
            </>
          ) : (
            <Empty title="Payment data not connected" icon={<Wallet aria-hidden />}>
              No payment provider is sending transactions yet, so revenue, MRR, upgrades, downgrades and cancellations are not shown. Nothing is estimated.
            </Empty>
          )}
        </Card>
        <Card title="Plan distribution" description="Accounts by current plan">
          <BarList data={["free", "plus", "business"].map((p) => ({ key: p, label: p === "plus" ? "Plus" : p[0].toUpperCase() + p.slice(1), value: Number(o.plan_distribution?.[p] || 0) }))} empty="No accounts yet." />
          {!connected && Number(o.paid_profiles) > 0 && <p className="ad-sub" style={{ marginTop: 10 }}>Paid-plan accounts were assigned by an admin; no payment provider is connected.</p>}
        </Card>
        <Card title="Retention & engagement" description={`Within ${range.label.toLowerCase()}`} actions={<Link className="ad-btn ad-btn-sm" href={`/admin/analytics/retention${rq ? "?" + rq : ""}`}>Retention</Link>}>
          <Stats items={[
            { label: "Returning users", value: Number(o.returning_users) },
            { label: "Repeat scanners (2+)", value: Number(o.repeat_scanners) },
            { label: "Planner users", value: Number(o.planner_users) },
            { label: "Reminder users", value: Number(o.reminder_users) },
          ]} />
          <p className="ad-sub" style={{ marginTop: 10 }}>Returning = active in the period and registered before it began.</p>
        </Card>
        <Card title="Calendar" description="Connected providers and calendar saves" actions={<Link className="ad-btn ad-btn-sm" href={`/admin/calendar${rq ? "?" + rq : ""}`}>Calendar</Link>}>
          <BarList data={Object.entries(o.calendar_providers || {}).map(([k, v]) => ({ key: k, label: k[0].toUpperCase() + k.slice(1), value: Number(v) }))} empty="No direct calendar connections yet." />
          <div style={{ marginTop: 14 }}>
            {ts.error ? null : <BarChart height={140} data={series} series={[{ key: "calendar_saves", label: "Calendar saves", color: SERIES_COLORS[1] }]} emptyText="No calendar saves in this period." />}
          </div>
        </Card>
        <Card title="Product usage" description={`Created per ${range.bucket}`} actions={<Link className="ad-btn ad-btn-sm" href={`/admin/analytics${rq ? "?" + rq : ""}`}>Analytics</Link>}>
          {ts.error ? <LoadError error={ts.error} /> : (
            <LineChart data={series} series={[
              { key: "planner", label: "Planner items", color: SERIES_COLORS[0] },
              { key: "todos_done", label: "To-dos completed", color: SERIES_COLORS[1] },
              { key: "reminders", label: "Reminders", color: SERIES_COLORS[2] },
            ]} />
          )}
        </Card>
      </div>
    </>
  );
}
