import { CheckCircle2, Clock, ListChecks } from "lucide-react";
import { adminRpc, iso } from "@/lib/admin/server";
import { fmtPercent, ratio } from "@/lib/admin/format";
import { BarList, Card, Kpi, Kpis, LoadError, PageHeader } from "../_components/ui";
import { LineChart } from "../_components/charts";
import { SERIES_COLORS } from "@/lib/admin/palette";
import { readParams, rangeFrom, type SearchParams } from "../_components/page-utils";

export const metadata = { title: "Planner & Tasks" };

export default async function PlannerPage({ searchParams }: { searchParams: SearchParams }) {
  const range = rangeFrom(await readParams(searchParams));
  const [res, ts] = await Promise.all([
    adminRpc<any>("admin_usage", { p_from: iso(range.from), p_to: iso(range.to) }),
    adminRpc<any[]>("admin_timeseries", { p_from: iso(range.from), p_to: iso(range.to), p_bucket: range.bucket }),
  ]);
  const head = <PageHeader title="Planner & Tasks" description={`Events, tasks and deadlines people organise · ${range.label}`} />;
  if (res.error) return <>{head}<Card><LoadError error={res.error} retryHref="/admin/planner" /></Card></>;
  const p = res.data.planner, t = res.data.todo;
  return (
    <>
      {head}
      <Kpis>
        <Kpi label="Planner items created" icon={<ListChecks aria-hidden />} value={Number(p.created)} foot={`${p.from_scans} from scans`} />
        <Kpi label="Items completed" icon={<CheckCircle2 aria-hidden />} value={Number(p.completed)} />
        <Kpi label="To-dos created" icon={<ListChecks aria-hidden />} value={Number(t.created)} foot="Tasks and deadlines" />
        <Kpi label="To-dos completed" icon={<CheckCircle2 aria-hidden />} value={Number(t.completed)} />
        <Kpi label="To-do completion rate" icon={<CheckCircle2 aria-hidden />} value={Number(t.created) ? fmtPercent(ratio(t.completed_of_created, t.created)) : null}
          unavailable="No to-dos in period" foot="Of to-dos created in the period" />
        <Kpi label="Open · upcoming" icon={<Clock aria-hidden />} value={Number(p.upcoming)} foot="Right now" />
        <Kpi label="Open · overdue" icon={<Clock aria-hidden />} value={Number(p.overdue)} foot="Right now" invert />
      </Kpis>
      <div className="zadm-grid zadm-grid-21">
        <Card title="Created and completed">
          {ts.error ? <LoadError error={ts.error} /> : <LineChart data={ts.data!} series={[
            { key: "planner", label: "Items created", color: SERIES_COLORS[0] },
            { key: "todos_done", label: "To-dos completed", color: SERIES_COLORS[1] },
          ]} />}
        </Card>
        <Card title="Created by type">
          <BarList data={[{ label: "Events", value: Number(p.events) }, { label: "Tasks", value: Number(p.tasks) }, { label: "Deadlines", value: Number(p.deadlines) }]} empty="Nothing created in this period." />
        </Card>
      </div>
    </>
  );
}
