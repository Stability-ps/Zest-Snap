import { CalendarDays, CalendarPlus, Link2 } from "lucide-react";
import { adminRpc, iso } from "@/lib/admin/server";
import { BarList, Card, Kpi, Kpis, LoadError, PageHeader } from "../_components/ui";
import { BarChart } from "../_components/charts";
import { SERIES_COLORS } from "@/lib/admin/palette";
import { readParams, rangeFrom, type SearchParams } from "../_components/page-utils";

export const metadata = { title: "Calendar" };
const providerLabel = (k: string) => ({ ics: "Calendar file (.ics)", google: "Google Calendar", apple: "Apple Calendar", outlook: "Outlook", file: "File / handoff" } as Record<string, string>)[k] || k;

export default async function CalendarPage({ searchParams }: { searchParams: SearchParams }) {
  const range = rangeFrom(await readParams(searchParams));
  const [res, ts] = await Promise.all([
    adminRpc<any>("admin_usage", { p_from: iso(range.from), p_to: iso(range.to) }),
    adminRpc<any[]>("admin_timeseries", { p_from: iso(range.from), p_to: iso(range.to), p_bucket: range.bucket }),
  ]);
  const head = <PageHeader title="Calendar" description={`Calendar connections and events saved to calendars · ${range.label}`} />;
  if (res.error) return <>{head}<Card><LoadError error={res.error} retryHref="/admin/calendar" /></Card></>;
  const c = res.data.calendar;
  return (
    <>
      {head}
      <Kpis>
        <Kpi label="Direct connections" icon={<Link2 aria-hidden />} value={Number(c.connections)} foot="All time" />
        <Kpi label="Events saved to calendars" icon={<CalendarPlus aria-hidden />} value={Number(c.exports)} foot={range.label} />
        <Kpi label="Google Calendar adds" icon={<CalendarDays aria-hidden />} value={Number(c.exports_by_provider?.google || 0)} />
      </Kpis>
      <div className="zadm-grid zadm-grid-21">
        <Card title="Calendar saves">
          {ts.error ? <LoadError error={ts.error} /> : <BarChart data={ts.data!} series={[{ key: "calendar_saves", label: "Calendar saves", color: SERIES_COLORS[1] }]} emptyText="No calendar saves recorded in this period." />}
        </Card>
        <Card title="By provider">
          <BarList data={Object.entries(c.exports_by_provider || {}).map(([k, v]) => ({ key: k, label: providerLabel(k), value: Number(v) }))} empty="No saves in this period." />
          <h3 style={{ fontSize: 13, margin: "18px 0 10px" }}>Connected accounts</h3>
          <BarList data={Object.entries(c.by_provider || {}).map(([k, v]) => ({ key: k, label: providerLabel(k), value: Number(v) }))} empty="No direct connections yet." />
        </Card>
      </div>
    </>
  );
}
