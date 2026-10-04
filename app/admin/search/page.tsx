import Link from "next/link";
import { Search } from "lucide-react";
import { adminRpc } from "@/lib/admin/server";
import { humanize } from "@/lib/admin/format";
import { Card, Empty, LoadError, PageHeader, PlanBadge, StatusBadge } from "../_components/ui";
import { readParams, type SearchParams } from "../_components/page-utils";

export const metadata = { title: "Search" };

function Group({ title, children, n }: { title: string; children: React.ReactNode; n: number }) {
  return n ? <Card title={`${title} · ${n}`} flush><div className="ad-list">{children}</div></Card> : null;
}

export default async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await readParams(searchParams);
  const q = (params.q || "").trim();
  const head = <PageHeader title="Search" description={q ? `Results for “${q}”` : "Search users, e-mails, user IDs, scan request IDs, tickets, reports and referral codes."} />;
  if (q.length < 2) return <>{head}<Card><Empty title="Type at least 2 characters" icon={<Search aria-hidden />}>Press / anywhere in Admin to jump to search.</Empty></Card></>;
  const res = await adminRpc<any>("admin_search", { p_q: q });
  if (res.error) return <>{head}<Card><LoadError error={res.error} /></Card></>;
  const d = res.data;
  const total = ["users", "scans", "tickets", "reports", "referrals"].reduce((a, k) => a + (d[k]?.length || 0), 0);
  if (!total) return <>{head}<Card><Empty title="No results" icon={<Search aria-hidden />}>Try an e-mail, a full user or request ID, a ticket number (#1001) or a referral code.</Empty></Card></>;
  return (
    <>
      {head}
      <div className="ad-results">
        <Group title="Users" n={d.users.length}>{d.users.map((u: any) => <Link key={u.id} className="ad-list-row" href={`/admin/users/${u.id}`}><span className="grow"><b>{u.name || u.email}</b><span className="ad-sub">{u.email} · <span className="ad-mono">{u.id}</span></span></span><PlanBadge plan={u.plan} /></Link>)}</Group>
        <Group title="Scan requests" n={d.scans.length}>{d.scans.map((s: any) => <Link key={s.id} className="ad-list-row" href={`/admin/scans?request=${s.id}`}><span className="grow ad-mono">{s.id}</span><StatusBadge status={s.status} /></Link>)}</Group>
        <Group title="Support tickets" n={d.tickets.length}>{d.tickets.map((t: any) => <Link key={t.id} className="ad-list-row" href={`/admin/support?status=all&t=${t.id}`}><b>#{t.number}</b><span className="grow ad-trunc">{t.subject}</span><StatusBadge status={t.status} /></Link>)}</Group>
        <Group title="Reports" n={d.reports.length}>{d.reports.map((r: any) => <Link key={r.id} className="ad-list-row" href={`/admin/reports?status=all&r=${r.id}`}><b>#{r.number}</b><span className="grow ad-trunc">{humanize(r.kind)} — {r.description}</span><StatusBadge status={r.status} /></Link>)}</Group>
        <Group title="Referral codes" n={d.referrals.length}>{d.referrals.map((r: any) => <Link key={r.code} className="ad-list-row" href={`/admin/users/${r.user_id}`}><b className="ad-mono">{r.code}</b><span className="grow ad-trunc">{r.email}</span><span className="ad-sub">{r.uses} uses</span></Link>)}</Group>
      </div>
    </>
  );
}
