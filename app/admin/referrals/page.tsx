import Link from "next/link";
import { AlertTriangle, Gift, Link2, Share2, UserCheck } from "lucide-react";
import { adminRpc, iso } from "@/lib/admin/server";
import { fmtDateTime, fmtNumber, fmtPercent, ratio } from "@/lib/admin/format";
import { Badge, Card, Chips, Empty, Kpi, Kpis, LoadError, Notice, PageHeader, Pager, StatusBadge } from "../_components/ui";
import { linkWith, pageOf, readParams, rangeFrom, type SearchParams } from "../_components/page-utils";

export const metadata = { title: "Referrals" };
const PAGE = 50;
const statuses = ["", "invited", "signed_up", "qualified", "rewarded"];

export default async function ReferralsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await readParams(searchParams);
  const range = rangeFrom(params);
  const page = pageOf(params);
  const status = statuses.includes(params.status || "") ? params.status || "" : "";
  const res = await adminRpc<any>("admin_referrals", { p_from: iso(range.from), p_to: iso(range.to), p_status: status || null, p_limit: PAGE, p_offset: page * PAGE });
  const head = <PageHeader title="Referrals" description={`Invites and qualified referrals · ${range.label}`} actions={<Link className="zadm-btn" href="/admin/exports?dataset=referrals">Export referrals</Link>} />;
  if (res.error) return <>{head}<Card><LoadError error={res.error} retryHref="/admin/referrals" /></Card></>;
  const d = res.data;
  const pending = Number(d.by_status?.signed_up || 0) + Number(d.by_status?.invited || 0);
  return (
    <>
      {head}
      <Kpis>
        <Kpi label="Invite codes created" icon={<Link2 aria-hidden />} value={Number(d.invite_codes)} foot="All time" />
        <Kpi label="Referral sign-ups" icon={<Share2 aria-hidden />} value={Number(d.total)} />
        <Kpi label="Qualified" icon={<UserCheck aria-hidden />} value={Number(d.qualified)} foot="After a successful first scan" />
        <Kpi label="Conversion" icon={<UserCheck aria-hidden />} value={Number(d.total) ? fmtPercent(ratio(d.qualified, d.total)) : null} unavailable="No referrals yet" />
        <Kpi label="Pending" icon={<Share2 aria-hidden />} value={pending} />
        <Kpi label="Credits issued" icon={<Gift aria-hidden />} value={Number(d.credits)} />
      </Kpis>
      {d.signals.length > 0 && (
        <Notice tone="warn" title="Possible abuse signals — review before acting">
          {d.signals.length} referrer{d.signals.length > 1 ? "s show" : " shows"} patterns worth a look (shared devices with invitees or 5+ sign-ups in one day).
          Nothing has been blocked automatically; device and monthly caps already limit rewards.
        </Notice>
      )}
      <div className="zadm-grid zadm-grid-2">
        <Card title="Top referrers" flush>
          {d.top.length ? (
            <div className="zadm-list">{d.top.map((t: any) => (
              <Link key={t.user_id} className="zadm-list-row" href={`/admin/users/${t.user_id}`}><span className="grow zadm-trunc">{t.email}</span><span className="zadm-sub">{fmtNumber(t.qualified)} qualified</span><b>{fmtNumber(t.total)}</b></Link>
            ))}</div>
          ) : <Empty title="No referrals in this period" />}
        </Card>
        <Card title="Signals" description="Heuristics only. Legitimate families often share a device." flush>
          {d.signals.length ? (
            <div className="zadm-list">{d.signals.map((s: any, i: number) => (
              <Link key={i} className="zadm-list-row" href={`/admin/users/${s.user_id}`}><AlertTriangle size={16} color="var(--zadm-warn)" aria-hidden /><span className="grow zadm-trunc">{s.email}</span>
                <Badge tone="warn">{s.signal === "shared_device" ? "Shared device" : "Burst in 24h"}</Badge><b>{fmtNumber(s.n)}</b></Link>
            ))}</div>
          ) : <Empty title="No signals">No shared-device or burst patterns found.</Empty>}
        </Card>
      </div>
      <Card flush>
        <div style={{ padding: "14px 18px 0" }}>
          <Chips current={status} items={statuses.map((s) => ({ key: s, label: s ? s.replace("_", " ").replace(/^\w/, (c) => c.toUpperCase()) : "All", href: linkWith("/admin/referrals", params, { status: s || null }), count: s ? Number(d.by_status?.[s] || 0) : undefined }))} />
        </div>
        <div style={{ marginTop: 12 }}>
          {!d.rows.length ? <Empty title="No referrals match" /> : (
            <>
              <div className="zadm-table-wrap"><table className="zadm-table">
                <thead><tr><th>Date</th><th>Referrer</th><th>Invitee</th><th>Code</th><th>Status</th><th>Qualified</th></tr></thead>
                <tbody>{d.rows.map((r: any) => (
                  <tr key={r.id}>
                    <td className="nowrap">{fmtDateTime(r.created_at)}</td>
                    <td><Link className="zadm-row-link" href={`/admin/users/${r.referrer_id}`}>{r.referrer_email}</Link></td>
                    <td>{r.referred_user_id ? <Link className="zadm-row-link" href={`/admin/users/${r.referred_user_id}`}>{r.referred_email}</Link> : "—"}</td>
                    <td className="zadm-mono">{r.code}</td><td><StatusBadge status={r.status} /></td><td className="nowrap">{fmtDateTime(r.qualified_at)}</td>
                  </tr>
                ))}</tbody>
              </table></div>
              <Pager total={Number(d.total)} page={page} pageSize={PAGE} href={(p) => linkWith("/admin/referrals", params, { page: p || null })} />
            </>
          )}
        </div>
      </Card>
    </>
  );
}
