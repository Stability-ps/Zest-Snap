import { Repeat, ScanLine, ListChecks, BellRing } from "lucide-react";
import { adminRpc, iso } from "@/lib/admin/server";
import { fmtPercent, ratio } from "@/lib/admin/format";
import { Card, Kpi, Kpis, LoadError, Notice, PageHeader } from "../../_components/ui";
import { LineChart } from "../../_components/charts";
import { SERIES_COLORS } from "@/lib/admin/palette";
import { readParams, rangeFrom, type SearchParams } from "../../_components/page-utils";
import { AnalyticsTabs } from "../tabs";

export const metadata = { title: "Retention" };

export default async function Retention({ searchParams }: { searchParams: SearchParams }) {
  const range = rangeFrom(await readParams(searchParams));
  const [ov, ts] = await Promise.all([
    adminRpc<any>("admin_overview", { p_from: iso(range.from), p_to: iso(range.to) }),
    adminRpc<any[]>("admin_timeseries", { p_from: iso(range.from), p_to: iso(range.to), p_bucket: range.bucket }),
  ]);
  const head = <><PageHeader title="Analytics" description={`Are people coming back? · ${range.label}`} /><AnalyticsTabs current="retention" range={range} /></>;
  if (ov.error) return <>{head}<Card><LoadError error={ov.error} retryHref="/admin/analytics/retention" /></Card></>;
  const o = ov.data;
  const active = Number(o.active_period);
  return (
    <>
      {head}
      <Kpis>
        <Kpi label="Returning users" icon={<Repeat aria-hidden />} value={Number(o.returning_users)} foot={active ? `${fmtPercent(ratio(o.returning_users, active))} of active` : "Registered before the period"} />
        <Kpi label="Repeat scanners" icon={<ScanLine aria-hidden />} value={Number(o.repeat_scanners)} foot="2+ scans in the period" />
        <Kpi label="Planner users" icon={<ListChecks aria-hidden />} value={Number(o.planner_users)} foot="Created a Planner item" />
        <Kpi label="Reminder users" icon={<BellRing aria-hidden />} value={Number(o.reminder_users)} foot="Created a reminder" />
        <Kpi label="Stickiness (DAU/MAU)" icon={<Repeat aria-hidden />} value={Number(o.active_30d) ? fmtPercent(ratio(o.active_today, o.active_30d)) : null} unavailable="No active users yet" />
      </Kpis>
      <Card title="Active users over time">
        {ts.error ? <LoadError error={ts.error} /> : <LineChart data={ts.data!} series={[{ key: "active", label: "Active users", color: SERIES_COLORS[0] }]} />}
      </Card>
      <Notice>
        Cohort retention curves need several weeks of app-open data, which is recorded from this release. Until then, retention uses real repeat behaviour (scans, Planner and reminders); nothing is projected.
      </Notice>
    </>
  );
}
