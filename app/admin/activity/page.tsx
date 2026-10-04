import Link from "next/link";
import { Activity, Smartphone } from "lucide-react";
import { adminRpc, iso } from "@/lib/admin/server";
import { fmtDate, fmtRelative } from "@/lib/admin/format";
import { Card, Empty, Kpi, Kpis, LoadError, Notice, PageHeader, PlanBadge } from "../_components/ui";
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
      <Notice>
        Active means a recorded action: opening the app while signed in{o.activity_tracking_since ? ` (tracked since ${fmtDate(o.activity_tracking_since)})` : " (tracked from this release)"}, an AI scan, Planner activity or feedback.
        Sessions and devices are stored as anonymous hashes, so individual devices are not listed.
      </Notice>
    </>
  );
}
