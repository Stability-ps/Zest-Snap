import Link from "next/link";
import { Activity, Smartphone } from "lucide-react";
import { adminRpc, iso } from "@/lib/admin/server";
import { fmtDate, fmtRelative } from "@/lib/admin/format";
import { BarList, Card, Empty, Kpi, Kpis, LoadError, Notice, PageHeader, PlanBadge } from "../_components/ui";
import { LineChart } from "../_components/charts";
import { SERIES_COLORS } from "@/lib/admin/palette";
import { readParams, rangeFrom, type SearchParams } from "../_components/page-utils";

export const metadata = { title: "Activity" };

export default async function ActivityPage({ searchParams }: { searchParams: SearchParams }) {
  const range = rangeFrom(await readParams(searchParams));
  const [ov, ts, recent, health] = await Promise.all([
    adminRpc<any>("admin_overview", { p_from: iso(range.from), p_to: iso(range.to) }),
    adminRpc<any[]>("admin_timeseries", { p_from: iso(range.from), p_to: iso(range.to), p_bucket: range.bucket }),
    adminRpc<any>("admin_users", { p_search: null, p_filter: "active", p_sort: "active_desc", p_limit: 20, p_offset: 0 }),
    adminRpc<any>("admin_health"),
  ]);
  const platforms = await adminRpc<any>("admin_platforms", { p_from: iso(range.from), p_to: iso(range.to) });
  const head = <PageHeader title="Activity" description={`Who is using Zest Snap · ${range.label}`} actions={<Link className="ad-btn" href="/admin/exports?dataset=activity">Export activity</Link>} />;
  if (ov.error) return <>{head}<Card><LoadError error={ov.error} retryHref="/admin/activity" /></Card></>;
  const o = ov.data;
  return (
    <>
      {head}
      <Kpis>
        <Kpi label="Active today (DAU)" icon={<Activity aria-hidden />} value={Number(o.active_today)} />
        <Kpi label="Active 7 days (WAU)" icon={<Activity aria-hidden />} value={Number(o.active_7d)} />
        <Kpi label="Active 30 days (MAU)" icon={<Activity aria-hidden />} value={Number(o.active_30d)} />
        <Kpi label="Active in period" icon={<Activity aria-hidden />} value={Number(o.active_period)} />
        <Kpi label="Push-enabled devices" icon={<Smartphone aria-hidden />} value={health.data ? Number(health.data.push_subscriptions) : null} />
      </Kpis>
      <div className="ad-grid ad-grid-21">
        <Card title={`Active users per ${range.bucket}`}>{ts.error ? <LoadError error={ts.error} /> : <LineChart data={ts.data!} series={[{ key: "active", label: "Active users", color: SERIES_COLORS[0] }]} />}</Card>
        <Card title="Recently active" flush>
          {recent.data?.rows?.length ? (
            <div className="ad-list">{recent.data.rows.map((u: any) => (
              <Link key={u.id} className="ad-list-row" href={`/admin/users/${u.id}`}>
                <span className="grow"><b className="ad-trunc">{u.display_name || u.email}</b><span className="ad-sub">{fmtRelative(u.last_active)}</span></span>
                <PlanBadge plan={u.plan} />
              </Link>
            ))}</div>
          ) : <Empty title="Nobody active in the last 30 days" />}
        </Card>
      </div>
      <div className="ad-grid ad-grid-2">
        <Card title="Active people by platform" description="Web, installed web app (PWA), iOS and Android">
          {platforms.error ? <LoadError error={platforms.error} /> : (
            <BarList data={Object.entries(platforms.data?.active_by_platform || {}).map(([k, v]) => ({ key: k, label: ({ web: "Web", pwa: "Installed web app", ios: "iOS app", android: "Android app" } as Record<string, string>)[k] || "Not recorded", value: Number(v) }))} empty="No platform data recorded yet." />
          )}
        </Card>
        <Card title="Paid subscriptions by source" description="Where active subscriptions were bought">
          {platforms.error ? <LoadError error={platforms.error} /> : (
            <BarList data={Object.entries(platforms.data?.subscriptions_by_source || {}).map(([k, v]) => ({ key: k, label: ({ app_store: "Apple App Store", play_store: "Google Play", web: "Web" } as Record<string, string>)[k] || k, value: Number(v) }))} empty="No paid subscriptions yet." />
          )}
          {platforms.data?.versions?.length > 0 && (
            <p className="ad-sub" style={{ marginTop: 12 }}>Top builds: {platforms.data.versions.slice(0, 4).map((v: any) => `${v.app_version} (${v.n})`).join(" · ")}</p>
          )}
        </Card>
      </div>
      <Notice>
        Active means a recorded action: opening the app while signed in{o.activity_tracking_since ? ` (tracked since ${fmtDate(o.activity_tracking_since)})` : " (tracked from this release)"}, an AI scan, Planner activity or feedback.
        Sessions and devices are stored as anonymous hashes, so individual devices are not listed.
      </Notice>
    </>
  );
}
