import { UserPlus, Users } from "lucide-react";
import { adminRpc, iso } from "@/lib/admin/server";
import { fmtDate, pctChange } from "@/lib/admin/format";
import { BarList, Card, Kpi, Kpis, LoadError, PageHeader } from "../../_components/ui";
import { BarChart, LineChart } from "../../_components/charts";
import { SERIES_COLORS } from "@/lib/admin/palette";
import { readParams, rangeFrom, type SearchParams } from "../../_components/page-utils";
import { AnalyticsTabs } from "../tabs";

export const metadata = { title: "User Growth" };

export default async function Growth({ searchParams }: { searchParams: SearchParams }) {
  const range = rangeFrom(await readParams(searchParams));
  const [ov, ts] = await Promise.all([
    adminRpc<any>("admin_overview", { p_from: iso(range.from), p_to: iso(range.to) }),
    adminRpc<any[]>("admin_timeseries", { p_from: iso(range.from), p_to: iso(range.to), p_bucket: range.bucket }),
  ]);
  const head = <><PageHeader title="Analytics" description={`Registrations and accounts · ${range.label}`} /><AnalyticsTabs current="growth" range={range} /></>;
  if (ov.error) return <>{head}<Card><LoadError error={ov.error} retryHref="/admin/analytics/growth" /></Card></>;
  const o = ov.data;
  const base = Number(o.users_total) - Number(o.new_users);
  const cumulative = (ts.data || []).reduce<any[]>((acc, p) => [...acc, { ...p, total: (acc.at(-1)?.total ?? base) + Number(p.signups) }], []);
  return (
    <>
      {head}
      <Kpis>
        <Kpi label="Registered users" icon={<Users aria-hidden />} value={Number(o.users_total)} delta={pctChange(o.users_total, o.users_total_prev)} />
        <Kpi label="New in period" icon={<UserPlus aria-hidden />} value={Number(o.new_users)} delta={pctChange(o.new_users, o.new_users_prev)} />
        <Kpi label="New today" icon={<UserPlus aria-hidden />} value={Number(o.new_users_today)} />
        <Kpi label="New this month" icon={<UserPlus aria-hidden />} value={Number(o.new_users_month)} />
        <Kpi label="First sign-up" icon={<Users aria-hidden />} value={o.first_signup ? fmtDate(o.first_signup) : null} />
      </Kpis>
      <div className="ad-grid ad-grid-2">
        <Card title={`Registrations per ${range.bucket}`}>{ts.error ? <LoadError error={ts.error} /> : <BarChart data={ts.data!} series={[{ key: "signups", label: "Sign-ups", color: SERIES_COLORS[0] }]} />}</Card>
        <Card title="Total registered users">{ts.error ? <LoadError error={ts.error} /> : <LineChart data={cumulative} series={[{ key: "total", label: "Registered users", color: SERIES_COLORS[1] }]} />}</Card>
        <Card title="Plan distribution">
          <BarList data={["free", "plus", "business"].map((p) => ({ key: p, label: p === "plus" ? "Plus" : p[0].toUpperCase() + p.slice(1), value: Number(o.plan_distribution?.[p] || 0) }))} />
        </Card>
        <Card title="Active users">{ts.error ? <LoadError error={ts.error} /> : <LineChart data={ts.data!} series={[{ key: "active", label: "Active users", color: SERIES_COLORS[0] }]} />}</Card>
      </div>
    </>
  );
}
