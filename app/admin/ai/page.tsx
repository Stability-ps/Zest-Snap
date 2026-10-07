import Link from "next/link";
import { Clock, Cpu, DollarSign, ScanLine, Sparkles, Users } from "lucide-react";
import { adminRpc, iso } from "@/lib/admin/server";
import { fmtDate, fmtDuration, fmtMoney, fmtNumber, fmtPercent, humanize, ratio } from "@/lib/admin/format";
import { BarList, Card, Empty, Kpi, Kpis, LoadError, Notice, PageHeader } from "../_components/ui";
import { LineChart } from "../_components/charts";
import { SERIES_COLORS } from "@/lib/admin/palette";
import { readParams, rangeFrom, type SearchParams } from "../_components/page-utils";

export const metadata = { title: "AI Usage" };

export default async function AiPage({ searchParams }: { searchParams: SearchParams }) {
  const range = rangeFrom(await readParams(searchParams));
  const [res, ts] = await Promise.all([
    adminRpc<any>("admin_ai", { p_from: iso(range.from), p_to: iso(range.to) }),
    adminRpc<any[]>("admin_timeseries", { p_from: iso(range.from), p_to: iso(range.to), p_bucket: range.bucket }),
  ]);
  const head = <PageHeader title="AI Usage" description={`Signed-in AI extraction requests and measured cost · ${range.label}`} />;
  if (res.error) return <>{head}<Card><LoadError error={res.error} retryHref="/admin/ai" /></Card></>;
  const d = res.data;
  const done = Number(d.completed) + Number(d.failed);
  const costKnown = Number(d.cost_rows) > 0;
  return (
    <>
      {head}
      <Kpis>
        <Kpi label="AI requests" icon={<Sparkles aria-hidden />} value={Number(d.requests)} />
        <Kpi label="Requests per user" icon={<Users aria-hidden />} value={Number(d.users) ? fmtNumber(ratio(d.requests, d.users), 1) : null} unavailable="No requests yet" foot={`${fmtNumber(d.users)} people`} />
        <Kpi label="Successful extraction" icon={<ScanLine aria-hidden />} value={done ? fmtPercent(ratio(d.completed, done)) : null} unavailable="No completed requests" />
        <Kpi label="Failed extraction" icon={<ScanLine aria-hidden />} value={done ? fmtPercent(ratio(d.failed, done)) : null} unavailable="No completed requests" invert />
        <Kpi label="Avg events per scan" icon={<ScanLine aria-hidden />} value={d.avg_events === null ? null : fmtNumber(d.avg_events, 1)} unavailable="Not recorded yet" />
        <Kpi label="Avg processing time" icon={<Clock aria-hidden />} value={Number(d.duration_rows) ? fmtDuration(d.avg_duration_ms) : null} unavailable="Not recorded yet" />
        <Kpi label="Tokens" icon={<Cpu aria-hidden />} value={Number(d.token_rows) ? fmtNumber(Number(d.input_tokens) + Number(d.output_tokens)) : null} unavailable="Not recorded"
          foot={Number(d.token_rows) ? `${fmtNumber(d.input_tokens)} in · ${fmtNumber(d.output_tokens)} out` : undefined} />
        <Kpi label="Estimated AI cost" icon={<DollarSign aria-hidden />} value={costKnown ? fmtMoney(d.cost_usd) : null} unavailable="Not measured"
          foot={costKnown ? `${fmtNumber(d.cost_rows)} of ${fmtNumber(d.requests)} requests priced` : undefined} />
      </Kpis>
      {!costKnown && (
        <Notice title="Cost isn't estimated">
          Set <span className="zadm-mono">OPENAI_INPUT_USD_PER_MILLION</span> and <span className="zadm-mono">OPENAI_OUTPUT_USD_PER_MILLION</span> in Vercel to the model&apos;s published rates.
          Zest Snap never guesses prices; token counts are recorded either way.
        </Notice>
      )}
      <div className="zadm-grid zadm-grid-2">
        <Card title="Requests over time">
          {ts.error ? <LoadError error={ts.error} /> : <LineChart data={ts.data!} series={[{ key: "ai_requests", label: "AI requests", color: SERIES_COLORS[0] }]} />}
        </Card>
        <Card title="Tokens over time">
          {ts.error ? <LoadError error={ts.error} /> : <LineChart data={ts.data!} series={[{ key: "ai_tokens", label: "Tokens", color: SERIES_COLORS[1] }]} />}
        </Card>
        <Card title="File types"><BarList data={Object.entries(d.by_type || {}).map(([k, v]) => ({ key: k, label: k === "application/pdf" ? "PDF" : k, value: Number(v) }))} /></Card>
        <Card title="Failure reasons"><BarList data={Object.entries(d.errors || {}).map(([k, v]) => ({ key: k, label: humanize(k), value: Number(v) }))} empty="No recorded failures in this period." /></Card>
        <Card title="Models"><BarList data={Object.entries(d.by_model || {}).map(([k, v]) => ({ key: k, label: k, value: Number(v) }))} /></Card>
        <Card title="Heaviest users" flush>
          {d.top_users.length ? (
            <div className="zadm-list">{d.top_users.map((u: any) => (
              <Link key={u.user_id} className="zadm-list-row" href={`/admin/users/${u.user_id}`}><span className="grow zadm-trunc">{u.email}</span><span className="zadm-sub">{fmtNumber(u.tokens)} tokens</span><b>{fmtNumber(u.requests)}</b></Link>
            ))}</div>
          ) : <Empty title="No AI requests in this period" />}
        </Card>
      </div>
      <Notice>
        {d.metadata_since ? `Processing time, file type and event counts are recorded since ${fmtDate(d.metadata_since)}.` : "Processing time, file type and event counts are recorded from this release onward."}
        {" "}Guest-trial scans are counted on the Scans page; they carry no account or token data. Document contents are never stored for analytics.
      </Notice>
    </>
  );
}
