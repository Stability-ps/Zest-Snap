import Link from "next/link";
import { adminRpc, getAdmin, iso } from "@/lib/admin/server";
import { can } from "@/lib/admin/permissions";
import { Card, Chips, Empty, LoadError, PageHeader, Pager } from "../_components/ui";
import { FeedbackTable } from "../_components/feedback-table";
import { linkWith, pageOf, readParams, rangeFrom, type SearchParams } from "../_components/page-utils";

export const metadata = { title: "Feedback" };
const PAGE = 50;
const statuses = [["", "All"], ["new", "New"], ["reviewed", "Reviewed"], ["planned", "Planned"], ["resolved", "Resolved"], ["archived", "Archived"]];

export default async function FeedbackPage({ searchParams }: { searchParams: SearchParams }) {
  const admin = await getAdmin();
  const params = await readParams(searchParams);
  const range = rangeFrom(params);
  const page = pageOf(params);
  const status = statuses.some(([k]) => k && k === params.status) ? params.status : null;
  const res = await adminRpc<any>("admin_feedback", { p_from: iso(range.from), p_to: iso(range.to), p_rating: null, p_status: status, p_plan: null, p_q: params.q || null, p_limit: PAGE, p_offset: page * PAGE });
  const head = <PageHeader title="Feedback" description={`What people tell us, and what we did about it · ${range.label}`} actions={<Link className="ad-btn" href="/admin/ratings">Ratings overview</Link>} />;
  if (res.error) return <>{head}<Card><LoadError error={res.error} retryHref="/admin/feedback" /></Card></>;
  const byStatus = res.data.by_status || {};
  return (
    <>
      {head}
      <Card flush>
        <form className="ad-toolbar" action="/admin/feedback">
          <input className="ad-input" type="search" name="q" defaultValue={params.q || ""} placeholder="Search feedback text" aria-label="Search feedback" />
          {status && <input type="hidden" name="status" value={status} />}
          <button className="ad-btn">Search</button>
        </form>
        <div style={{ padding: "12px 18px" }}>
          <Chips current={status || ""} items={statuses.map(([k, l]) => ({ key: k, label: l, href: linkWith("/admin/feedback", params, { status: k || null }), count: k ? Number(byStatus[k] || 0) : undefined }))} />
        </div>
        {!res.data.rows.length ? <Empty title="No feedback matches">Feedback appears here when people rate or comment from Rewards.</Empty> : (
          <>
            <FeedbackTable rows={res.data.rows} canAct={can(admin.role, "support")} />
            <Pager total={Number(res.data.total)} page={page} pageSize={PAGE} href={(p) => linkWith("/admin/feedback", params, { page: p || null })} />
          </>
        )}
      </Card>
    </>
  );
}
