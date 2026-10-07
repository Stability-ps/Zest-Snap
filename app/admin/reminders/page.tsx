import { AlarmClock, BellRing, CheckCircle2, XCircle } from "lucide-react";
import { adminRpc, iso } from "@/lib/admin/server";
import { BarList, Card, Kpi, Kpis, LoadError, Notice, PageHeader } from "../_components/ui";
import { LineChart } from "../_components/charts";
import { SERIES_COLORS } from "@/lib/admin/palette";
import { readParams, rangeFrom, type SearchParams } from "../_components/page-utils";

export const metadata = { title: "Reminders" };

export default async function RemindersPage({ searchParams }: { searchParams: SearchParams }) {
  const range = rangeFrom(await readParams(searchParams));
  const [res, ts] = await Promise.all([
    adminRpc<any>("admin_usage", { p_from: iso(range.from), p_to: iso(range.to) }),
    adminRpc<any[]>("admin_timeseries", { p_from: iso(range.from), p_to: iso(range.to), p_bucket: range.bucket }),
  ]);
  const head = <PageHeader title="Reminders" description={`Reminders created in ${range.label.toLowerCase()} and what happened to them`} />;
  if (res.error) return <>{head}<Card><LoadError error={res.error} retryHref="/admin/reminders" /></Card></>;
  const r = res.data.reminders;
  return (
    <>
      {head}
      <Kpis>
        <Kpi label="Reminders created" icon={<BellRing aria-hidden />} value={Number(r.created)} />
        <Kpi label="Delivered" icon={<CheckCircle2 aria-hidden />} value={Number(r.sent)} foot="Push delivery recorded" />
        <Kpi label="Acted on" icon={<CheckCircle2 aria-hidden />} value={Number(r.handled)} foot="Marked done from the reminder" />
        <Kpi label="Snoozed" icon={<AlarmClock aria-hidden />} value={Number(r.snoozed)} />
        <Kpi label="Delivery failed" icon={<XCircle aria-hidden />} value={Number(r.failed)} invert />
        <Kpi label="Pending" icon={<AlarmClock aria-hidden />} value={Number(r.pending)} />
      </Kpis>
      <div className="zadm-grid zadm-grid-21">
        <Card title="Reminders created">
          {ts.error ? <LoadError error={ts.error} /> : <LineChart data={ts.data!} series={[{ key: "reminders", label: "Reminders", color: SERIES_COLORS[0] }]} />}
        </Card>
        <Card title="Outcome">
          <BarList data={[
            { label: "Pending", value: Number(r.pending) }, { label: "Delivered", value: Number(r.sent) }, { label: "Acted on", value: Number(r.handled) },
            { label: "Cancelled", value: Number(r.cancelled) }, { label: "Failed", value: Number(r.failed) },
          ]} empty="No reminders in this period." />
        </Card>
      </div>
      <Notice>“Opened” isn&apos;t measurable yet: push notifications don&apos;t report opens. “Acted on” counts reminders marked done or handled from the notification.</Notice>
    </>
  );
}
