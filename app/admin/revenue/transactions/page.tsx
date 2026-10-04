import Link from "next/link";
import { adminRpc, iso } from "@/lib/admin/server";
import { fmtDateTime, fmtMoney, humanize } from "@/lib/admin/format";
import { Card, Chips, Empty, LoadError, PageHeader, Pager, PlanBadge, StatusBadge } from "../../_components/ui";
import { linkWith, pageOf, readParams, rangeFrom, type SearchParams } from "../../_components/page-utils";
import { NotConnected, RevenueTabs } from "../tabs";

export const metadata = { title: "Transactions" };
const PAGE = 50;

export default async function TransactionsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await readParams(searchParams);
  const range = rangeFrom(params);
  const page = pageOf(params);
  const kind = ["charge", "refund"].includes(params.kind || "") ? params.kind : null;
  const status = ["succeeded", "failed", "pending"].includes(params.status || "") ? params.status : null;
  const currency = /^[A-Z]{3}$/.test(params.currency || "") ? params.currency : null;
  const [res, rev] = await Promise.all([
    adminRpc<any>("admin_transactions", { p_from: iso(range.from), p_to: iso(range.to), p_kind: kind, p_status: status, p_currency: currency, p_limit: PAGE, p_offset: page * PAGE }),
    adminRpc<any>("admin_revenue", { p_from: iso(range.from), p_to: iso(range.to) }),
  ]);
  const head = <><PageHeader title="Revenue" description={`Transactions · ${range.label}`} actions={<>
    <Link className="ad-btn" href="/admin/exports?dataset=transactions">Export</Link>
    <Link className="ad-btn" href="/admin/exports?dataset=failed_payments">Failed payments</Link>
    <Link className="ad-btn" href="/admin/exports?dataset=refunds">Refunds</Link></>} /><RevenueTabs current="transactions" range={range} /></>;
  if (res.error) return <>{head}<Card><LoadError error={res.error} retryHref="/admin/revenue/transactions" /></Card></>;
  if (rev.data && !rev.data.connected) return <>{head}<NotConnected /></>;
  return (
    <>
      {head}
      <Card flush>
        <div className="ad-toolbar" style={{ display: "grid", gap: 10 }}>
          <Chips current={kind || ""} items={[["", "All"], ["charge", "Charges"], ["refund", "Refunds"]].map(([k, l]) => ({ key: k, label: l, href: linkWith("/admin/revenue/transactions", params, { kind: k || null }) }))} />
          <Chips current={status || ""} items={[["", "Any status"], ["succeeded", "Succeeded"], ["failed", "Failed"], ["pending", "Pending"]].map(([k, l]) => ({ key: k, label: l, href: linkWith("/admin/revenue/transactions", params, { status: k || null }) }))} />
        </div>
        <div style={{ marginTop: 12 }}>
          {!res.data.rows.length ? <Empty title="No transactions match" /> : (
            <>
              <div className="ad-table-wrap"><table className="ad-table">
                <thead><tr><th>Time</th><th>User</th><th>Type</th><th>Plan</th><th>Status</th><th className="num">Amount</th><th>Country</th><th>Provider</th></tr></thead>
                <tbody>{res.data.rows.map((t: any) => (
                  <tr key={t.id}>
                    <td className="nowrap">{fmtDateTime(t.occurred_at)}</td>
                    <td>{t.user_id ? <Link className="ad-row-link" href={`/admin/users/${t.user_id}`}>{t.email || "User"}</Link> : "—"}</td>
                    <td>{humanize(t.kind)}</td><td><PlanBadge plan={t.plan} /></td><td><StatusBadge status={t.status} />{t.failure_reason && <span className="ad-sub">{t.failure_reason}</span>}</td>
                    <td className="num">{t.kind === "refund" ? "−" : ""}{fmtMoney(t.amount_cents / 100, t.currency)}</td><td>{t.country_code || "—"}</td><td>{t.provider}</td>
                  </tr>
                ))}</tbody>
              </table></div>
              <Pager total={Number(res.data.total)} page={page} pageSize={PAGE} href={(p) => linkWith("/admin/revenue/transactions", params, { page: p || null })} />
            </>
          )}
        </div>
      </Card>
    </>
  );
}
