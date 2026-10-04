import Link from "next/link";
import { MessageSquare, Star, ThumbsDown, ThumbsUp } from "lucide-react";
import { adminRpc, getAdmin, iso } from "@/lib/admin/server";
import { can } from "@/lib/admin/permissions";
import { fmtNumber, pctChange } from "@/lib/admin/format";
import { BarList, Card, Chips, Empty, Kpi, Kpis, LoadError, Notice, PageHeader, Pager } from "../_components/ui";
import { LineChart } from "../_components/charts";
import { SERIES_COLORS } from "@/lib/admin/palette";
import { FeedbackTable } from "../_components/feedback-table";
import { linkWith, pageOf, readParams, rangeFrom, type SearchParams } from "../_components/page-utils";

export const metadata = { title: "Ratings & Reviews" };
const PAGE = 50;

export default async function RatingsPage({ searchParams }: { searchParams: SearchParams }) {
  const admin = await getAdmin();
  const params = await readParams(searchParams);
  const range = rangeFrom(params);
  const page = pageOf(params);
  const rating = ["1", "2", "3", "4", "5"].includes(params.rating || "") ? Number(params.rating) : null;
  const plan = ["free", "plus", "business"].includes(params.plan || "") ? params.plan : null;
  const [res, ts] = await Promise.all([
    adminRpc<any>("admin_feedback", { p_from: iso(range.from), p_to: iso(range.to), p_rating: rating, p_status: null, p_plan: plan, p_q: params.q || null, p_limit: PAGE, p_offset: page * PAGE }),
    adminRpc<any[]>("admin_timeseries", { p_from: iso(range.from), p_to: iso(range.to), p_bucket: range.bucket === "day" && range.key !== "7d" && range.key !== "today" ? "week" : range.bucket }),
  ]);
  const head = <PageHeader title="Ratings & Reviews" description={`How people rate Zest Snap · ${range.label}`} actions={<Link className="ad-btn" href="/admin/exports?dataset=ratings">Export ratings</Link>} />;
  if (res.error) return <>{head}<Card><LoadError error={res.error} retryHref="/admin/ratings" /></Card></>;
  const d = res.data;
  return (
    <>
      {head}
      <Kpis>
        <Kpi label="Average rating (all time)" icon={<Star aria-hidden />} value={d.all_time.avg === null ? null : `${Number(d.all_time.avg).toFixed(2)} ★`} unavailable="No ratings yet" foot={`${fmtNumber(d.all_time.count)} ratings`} />
        <Kpi label="Average in period" icon={<Star aria-hidden />} value={d.period.avg === null ? null : `${Number(d.period.avg).toFixed(2)} ★`} unavailable="No ratings in period"
          delta={d.period.avg !== null && d.previous.avg !== null ? pctChange(d.period.avg, d.previous.avg) : undefined} />
        <Kpi label="Ratings in period" icon={<MessageSquare aria-hidden />} value={Number(d.period.count)} delta={pctChange(d.period.count, d.previous.count)} />
        <Kpi label="Positive (4–5★)" icon={<ThumbsUp aria-hidden />} value={Number(d.period.positive)} delta={pctChange(d.period.positive, d.previous.positive)} />
        <Kpi label="Negative (1–2★)" icon={<ThumbsDown aria-hidden />} value={Number(d.period.negative)} delta={pctChange(d.period.negative, d.previous.negative)} invert />
        <Kpi label="Written comments" icon={<MessageSquare aria-hidden />} value={Number(d.all_time.comments)} foot="All time" />
      </Kpis>
      <Notice>Credits are given for leaving feedback, never for a high score — every rating earns the same reward.</Notice>
      <div className="ad-grid ad-grid-21">
        <Card title="Average rating over time">{ts.error ? <LoadError error={ts.error} /> : <LineChart data={ts.data!} series={[{ key: "rating_avg", label: "Average rating", color: SERIES_COLORS[2] }]} format={(n) => `${n.toFixed(2)} ★`} emptyText="No ratings in this period." />}</Card>
        <Card title="Distribution" description={range.label}>
          <BarList data={[5, 4, 3, 2, 1].map((n) => ({ key: String(n), label: `${n} ★`, value: Number(d.distribution?.[String(n)] || 0) }))} empty="No ratings in this period." />
        </Card>
      </div>
      <Card flush>
        <form className="ad-toolbar" action="/admin/ratings">
          <input className="ad-input" type="search" name="q" defaultValue={params.q || ""} placeholder="Search feedback text" aria-label="Search feedback" />
          {params.range && <input type="hidden" name="range" value={params.range} />}
          {params.from && <input type="hidden" name="from" value={params.from} />}
          {params.to && <input type="hidden" name="to" value={params.to} />}
          <select className="ad-select" name="plan" defaultValue={plan || ""} aria-label="Plan"><option value="">All plans</option><option value="free">Free</option><option value="plus">Plus</option><option value="business">Business</option></select>
          <button className="ad-btn">Filter</button>
        </form>
        <div style={{ padding: "12px 18px" }}>
          <Chips current={rating ? String(rating) : ""} items={[["", "All ratings"], ["5", "5★"], ["4", "4★"], ["3", "3★"], ["2", "2★"], ["1", "1★"]].map(([k, l]) => ({ key: k, label: l, href: linkWith("/admin/ratings", params, { rating: k || null }) }))} />
        </div>
        {!d.rows.length ? <Empty title="No ratings match" /> : (
          <>
            <FeedbackTable rows={d.rows} canAct={can(admin.role, "support")} />
            <Pager total={Number(d.total)} page={page} pageSize={PAGE} href={(p) => linkWith("/admin/ratings", params, { page: p || null })} />
          </>
        )}
      </Card>
    </>
  );
}
