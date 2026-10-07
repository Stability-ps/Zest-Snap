import Link from "next/link";
import { BadgeDollarSign, Ban, RotateCcw, TrendingDown, TrendingUp, Users, Wallet, XCircle } from "lucide-react";
import { adminRpc, iso } from "@/lib/admin/server";
import { fmtMoney, fmtNumber, fmtPercent, ratio } from "@/lib/admin/format";
import { parseRange } from "@/lib/admin/range";
import { BarList, Card, Kpi, Kpis, LoadError, PageHeader } from "../_components/ui";
import { LineChart } from "../_components/charts";
import { SERIES_COLORS } from "@/lib/admin/palette";
import { readParams, rangeFrom, type SearchParams } from "../_components/page-utils";
import { NotConnected, RevenueTabs } from "./tabs";

export const metadata = { title: "Revenue" };
type Cur = { currency: string; gross: number; refunds: number; net: number; failed: number; charges: number; payers: number };
const fmtCur = (rows: Cur[], key: keyof Cur) => rows.length ? rows.map((r) => fmtMoney(r[key], r.currency)).join(" · ") : fmtMoney(0);

export default async function RevenuePage({ searchParams }: { searchParams: SearchParams }) {
  const range = rangeFrom(await readParams(searchParams));
  const today = parseRange({ range: "today" }), week = parseRange({ range: "7d" }), month = parseRange({ range: "month" });
  const [res, t, w, m, ts] = await Promise.all([
    adminRpc<any>("admin_revenue", { p_from: iso(range.from), p_to: iso(range.to) }),
    adminRpc<any>("admin_revenue", { p_from: iso(today.from), p_to: iso(today.to) }),
    adminRpc<any>("admin_revenue", { p_from: iso(week.from), p_to: iso(week.to) }),
    adminRpc<any>("admin_revenue", { p_from: iso(month.from), p_to: iso(month.to) }),
    adminRpc<any[]>("admin_timeseries", { p_from: iso(range.from), p_to: iso(range.to), p_bucket: range.bucket }),
  ]);
  const head = <><PageHeader title="Revenue" description={`Money in and out · ${range.label}`}
    actions={<Link className="zadm-btn" href="/admin/exports?dataset=revenue">Export revenue</Link>} /><RevenueTabs current="overview" range={range} /></>;
  if (res.error) return <>{head}<Card><LoadError error={res.error} retryHref="/admin/revenue" /></Card></>;
  const d = res.data;
  if (!d.connected) return <>{head}<NotConnected /></>;
  const rows: Cur[] = d.by_currency;
  const mrr: { currency: string; amount: number; subs: number }[] = d.mrr;
  const payers = rows.reduce((a, r) => a + Number(r.payers), 0);
  const subs = d.subscriptions;
  const churn = ratio(subs.canceled, Number(subs.active) + Number(subs.canceled));
  return (
    <>
      {head}
      <Kpis>
        <Kpi label="Gross revenue" icon={<Wallet aria-hidden />} value={fmtCur(rows, "gross")} />
        <Kpi label="Net revenue" icon={<Wallet aria-hidden />} value={fmtCur(rows, "net")} foot="After refunds (provider fees not included)" />
        <Kpi label="MRR" icon={<TrendingUp aria-hidden />} value={mrr.length ? mrr.map((x) => fmtMoney(x.amount, x.currency)).join(" · ") : fmtMoney(0)} foot="Active subscriptions × catalog price" />
        <Kpi label="ARR" icon={<TrendingUp aria-hidden />} value={mrr.length ? mrr.map((x) => fmtMoney(x.amount * 12, x.currency)).join(" · ") : fmtMoney(0)} foot="MRR × 12" />
        <Kpi label="Revenue today" icon={<Wallet aria-hidden />} value={fmtCur(t.data?.by_currency || [], "net")} />
        <Kpi label="Revenue · 7 days" icon={<Wallet aria-hidden />} value={fmtCur(w.data?.by_currency || [], "net")} />
        <Kpi label="Revenue this month" icon={<Wallet aria-hidden />} value={fmtCur(m.data?.by_currency || [], "net")} />
        <Kpi label="ARPU" icon={<Users aria-hidden />} value={payers && rows.length === 1 ? fmtMoney(rows[0].net / payers, rows[0].currency) : null}
          unavailable={rows.length > 1 ? "Mixed currencies" : "No paying users"} foot={`${fmtNumber(payers)} paying users`} />
        <Kpi label="Active subscriptions" icon={<BadgeDollarSign aria-hidden />} value={Number(subs.active)} />
        <Kpi label="New paid subscriptions" icon={<TrendingUp aria-hidden />} value={Number(subs.new)} />
        <Kpi label="Cancellations" icon={<Ban aria-hidden />} value={Number(subs.canceled)} foot={`${fmtNumber(subs.cancel_pending)} cancel at period end`} invert />
        <Kpi label="Churn" icon={<TrendingDown aria-hidden />} value={churn === null ? null : fmtPercent(churn)} unavailable="No subscriptions" invert />
        <Kpi label="Failed payments" icon={<XCircle aria-hidden />} value={rows.reduce((a, r) => a + Number(r.failed), 0)} invert />
        <Kpi label="Refunds" icon={<RotateCcw aria-hidden />} value={fmtCur(rows, "refunds")} invert />
        <Kpi label="Lifetime value" icon={<Users aria-hidden />} value={null} unavailable="Needs more history" />
      </Kpis>
      <div className="zadm-grid zadm-grid-2">
        <Card title="Net revenue over time">{ts.error ? <LoadError error={ts.error} /> : <LineChart data={ts.data!} series={[{ key: "revenue", label: "Net revenue", color: SERIES_COLORS[0] }]} format={(n) => fmtMoney(n)} />}</Card>
        <Card title="Revenue by plan">
          <BarList data={d.by_plan.map((p: any) => ({ key: p.plan + p.currency, label: `${p.plan} (${p.currency})`, value: Number(p.gross) }))} format={(n) => fmtNumber(n, 2)} />
        </Card>
      </div>
    </>
  );
}
