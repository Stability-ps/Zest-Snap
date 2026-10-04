import Link from "next/link";
import { adminRpc, iso } from "@/lib/admin/server";
import { fmtDate } from "@/lib/admin/format";
import { Card, Chips, Empty, LoadError, PageHeader, Pager, PlanBadge, StatusBadge } from "../../_components/ui";
import { linkWith, pageOf, readParams, rangeFrom, type SearchParams } from "../../_components/page-utils";
import { NotConnected, RevenueTabs } from "../tabs";

export const metadata = { title: "Subscriptions" };
const PAGE = 50;

export default async function SubscriptionsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await readParams(searchParams);
  const range = rangeFrom(params);
  const page = pageOf(params);
  const status = ["active", "trialing", "past_due", "canceled"].includes(params.status || "") ? params.status : null;
  const plan = ["plus", "business", "free"].includes(params.plan || "") ? params.plan : null;
  const [res, rev] = await Promise.all([
    adminRpc<any>("admin_subscriptions", { p_status: status, p_plan: plan, p_limit: PAGE, p_offset: page * PAGE }),
    adminRpc<any>("admin_revenue", { p_from: iso(range.from), p_to: iso(range.to) }),
  ]);
  const head = <><PageHeader title="Revenue" description="Subscriptions (current state, not date-filtered)" actions={<Link className="ad-btn" href="/admin/exports?dataset=subscriptions">Export</Link>} /><RevenueTabs current="subscriptions" range={range} /></>;
  if (res.error) return <>{head}<Card><LoadError error={res.error} retryHref="/admin/revenue/subscriptions" /></Card></>;
  if (rev.data && !rev.data.connected && !res.data.rows.length) return <>{head}<NotConnected /></>;
  return (
    <>
      {head}
      <Card flush>
        <div className="ad-toolbar" style={{ display: "grid", gap: 10 }}>
          <Chips current={status || ""} items={[["", "All"], ["active", "Active"], ["trialing", "Trialing"], ["past_due", "Past due"], ["canceled", "Canceled"]].map(([k, l]) => ({ key: k, label: l, href: linkWith("/admin/revenue/subscriptions", params, { status: k || null }) }))} />
          <Chips current={plan || ""} items={[["", "All plans"], ["plus", "Plus"], ["business", "Business"]].map(([k, l]) => ({ key: k, label: l, href: linkWith("/admin/revenue/subscriptions", params, { plan: k || null }) }))} />
        </div>
        <div style={{ marginTop: 12 }}>
          {!res.data.rows.length ? <Empty title="No subscriptions match" /> : (
            <>
              <div className="ad-table-wrap"><table className="ad-table">
                <thead><tr><th>User</th><th>Plan</th><th>Status</th><th>Started</th><th>Renews</th><th>Cancels</th><th>Provider</th></tr></thead>
                <tbody>{res.data.rows.map((s: any) => (
                  <tr key={s.id}>
                    <td><Link className="ad-row-link" href={`/admin/users/${s.user_id}`}>{s.email || "User"}</Link></td>
                    <td><PlanBadge plan={s.plan} /></td><td><StatusBadge status={s.status} /></td><td>{fmtDate(s.created_at)}</td>
                    <td>{fmtDate(s.current_period_end)}</td><td>{s.cancel_at_period_end ? "At period end" : s.canceled_at ? fmtDate(s.canceled_at) : "—"}</td><td>{s.provider || "—"}</td>
                  </tr>
                ))}</tbody>
              </table></div>
              <Pager total={Number(res.data.total)} page={page} pageSize={PAGE} href={(p) => linkWith("/admin/revenue/subscriptions", params, { page: p || null })} />
            </>
          )}
        </div>
      </Card>
    </>
  );
}
