import { adminRpc, iso } from "@/lib/admin/server";
import { fmtNumber, fmtPercent, humanize, ratio } from "@/lib/admin/format";
import { BarList, Card, LoadError, PageHeader, Stats } from "../_components/ui";
import { BarChart, LineChart } from "../_components/charts";
import { SERIES_COLORS } from "@/lib/admin/palette";
import { readParams, rangeFrom, type SearchParams } from "../_components/page-utils";
import { AnalyticsTabs } from "./tabs";

export const metadata = { title: "Product Analytics" };

export default async function ProductAnalytics({ searchParams }: { searchParams: SearchParams }) {
  const range = rangeFrom(await readParams(searchParams));
  const [res, ts] = await Promise.all([
    adminRpc<any>("admin_usage", { p_from: iso(range.from), p_to: iso(range.to) }),
    adminRpc<any[]>("admin_timeseries", { p_from: iso(range.from), p_to: iso(range.to), p_bucket: range.bucket }),
  ]);
  const head = <><PageHeader title="Analytics" description={`Which features people use · ${range.label}`} /><AnalyticsTabs current="product" range={range} /></>;
  if (res.error) return <>{head}<Card><LoadError error={res.error} retryHref="/admin/analytics" /></Card></>;
  const { scanning: s, planner: p, todo: t, reminders: r, calendar: c, rewards: w } = res.data;
  const finished = Number(s.completed) + Number(s.failed);
  return (
    <>
      {head}
      <Card title="Scanning">
        <Stats items={[
          { label: "Total scans", value: Number(s.total) },
          { label: "Successful", value: Number(s.completed) },
          { label: "Failed", value: Number(s.failed) },
          { label: "Success rate", value: fmtPercent(ratio(s.completed, finished)) },
          { label: "Multi-event extractions", value: Number(s.multi_event) },
          { label: "Scans per scanning user", value: Number(s.users) ? fmtNumber(ratio(s.account, s.users), 1) : "—" },
          { label: "Signed-in scans", value: Number(s.account) },
          { label: "Guest-trial scans", value: Number(s.guest) },
        ]} />
        <div className="ad-grid ad-grid-21" style={{ marginTop: 16 }}>
          {ts.error ? <LoadError error={ts.error} /> : <BarChart data={ts.data!} series={[{ key: "scans_ok", label: "Successful", color: SERIES_COLORS[0] }, { key: "scans_failed", label: "Failed", color: SERIES_COLORS[2] }]} />}
          <div style={{ display: "grid", gap: 18, alignContent: "start" }}>
            <div><h3 style={{ fontSize: 13, marginBottom: 10 }}>By file type</h3><BarList data={Object.entries(s.by_type || {}).map(([k, v]) => ({ key: k, label: k === "application/pdf" ? "PDF" : k, value: Number(v) }))} /></div>
            <div><h3 style={{ fontSize: 13, marginBottom: 10 }}>Processing failures</h3><BarList data={Object.entries(s.errors || {}).map(([k, v]) => ({ key: k, label: humanize(k), value: Number(v) }))} empty="No recorded failures." /></div>
          </div>
        </div>
      </Card>
      <div className="ad-grid ad-grid-2">
        <Card title="Planner">
          <Stats items={[
            { label: "Entries created", value: Number(p.created) }, { label: "Events", value: Number(p.events) }, { label: "Tasks", value: Number(p.tasks) },
            { label: "Deadlines", value: Number(p.deadlines) }, { label: "Completed", value: Number(p.completed) }, { label: "Overdue now", value: Number(p.overdue) },
            { label: "Upcoming now", value: Number(p.upcoming) },
          ]} />
        </Card>
        <Card title="To-do">
          <Stats items={[
            { label: "Created", value: Number(t.created) }, { label: "Completed", value: Number(t.completed) },
            { label: "Completion rate", value: fmtPercent(ratio(t.completed_of_created, t.created)) },
          ]} />
          <div style={{ marginTop: 14 }}>{ts.error ? null : <LineChart height={160} data={ts.data!} series={[{ key: "todos_done", label: "To-dos completed", color: SERIES_COLORS[1] }]} />}</div>
        </Card>
        <Card title="Reminders">
          <Stats items={[
            { label: "Created", value: Number(r.created) }, { label: "Delivered", value: Number(r.sent) }, { label: "Snoozed", value: Number(r.snoozed) },
            { label: "Acted on", value: Number(r.handled) }, { label: "Failed", value: Number(r.failed) }, { label: "Opened", value: "Not measurable" },
          ]} />
        </Card>
        <Card title="Calendar">
          <Stats items={[
            { label: "Connections", value: Number(c.connections) }, { label: "Events exported", value: Number(c.exports) },
            { label: "Google Calendar adds", value: Number(c.exports_by_provider?.google || 0) },
            { label: "Other providers", value: Number(c.exports) - Number(c.exports_by_provider?.google || 0) },
          ]} />
        </Card>
        <Card title="Rewards">
          <Stats items={[
            { label: "Credits issued", value: Number(w.issued) }, { label: "Credits spent", value: Number(w.spent) },
            { label: "Referral bonuses", value: Number(w.referral) }, { label: "Adjustments", value: Number(w.adjusted) },
          ]} />
          <div style={{ marginTop: 14 }}><BarList data={Object.entries(w.by_reason || {}).map(([k, v]) => ({ key: k, label: humanize(k), value: Number(v) }))} empty="No rewards earned in this period." /></div>
        </Card>
      </div>
    </>
  );
}
