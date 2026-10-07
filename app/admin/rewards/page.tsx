import Link from "next/link";
import { Coins, Gift, Settings2, Users, Wallet } from "lucide-react";
import { adminRpc, iso } from "@/lib/admin/server";
import { fmtDateTime, fmtNumber, humanize } from "@/lib/admin/format";
import { Badge, BarList, Card, Empty, Kpi, Kpis, LoadError, PageHeader } from "../_components/ui";
import { readParams, rangeFrom, type SearchParams } from "../_components/page-utils";

export const metadata = { title: "Rewards" };

export default async function RewardsPage({ searchParams }: { searchParams: SearchParams }) {
  const range = rangeFrom(await readParams(searchParams));
  const res = await adminRpc<any>("admin_rewards", { p_from: iso(range.from), p_to: iso(range.to) });
  const head = <PageHeader title="Rewards" description={`Zest Credits issued and used · ${range.label}`}
    actions={<><Link className="zadm-btn" href="/admin/rewards/rules"><Settings2 aria-hidden /> Reward rules</Link><Link className="zadm-btn" href="/admin/exports?dataset=rewards">Export ledger</Link></>} />;
  if (res.error) return <>{head}<Card><LoadError error={res.error} retryHref="/admin/rewards" /></Card></>;
  const d = res.data;
  return (
    <>
      {head}
      <Kpis>
        <Kpi label="Credits issued" icon={<Gift aria-hidden />} value={Number(d.period.issued)} foot={`${fmtNumber(d.period.users)} people earned`} />
        <Kpi label="Credits redeemed" icon={<Coins aria-hidden />} value={Number(d.period.spent)} foot="Spent on bonus scans" />
        <Kpi label="Admin adjustments" icon={<Settings2 aria-hidden />} value={Number(d.period.adjusted)} />
        <Kpi label="Outstanding balance" icon={<Wallet aria-hidden />} value={Number(d.outstanding)} foot="All accounts, all time" />
        <Kpi label="People holding credits" icon={<Users aria-hidden />} value={Number(d.holders)} />
      </Kpis>
      <div className="zadm-grid zadm-grid-2">
        <Card title="Rewards earned by type" description={range.label}>
          <BarList data={d.by_reason.filter((r: any) => r.credits > 0).map((r: any) => ({ key: r.reason, label: `${humanize(r.reason)} · ${fmtNumber(r.times)}×`, value: Number(r.credits) }))} empty="No credits issued in this period." />
        </Card>
        <Card title="Largest balances" flush>
          {d.top_balances.length ? (
            <div className="zadm-list">
              {d.top_balances.map((t: any) => (
                <Link key={t.user_id} className="zadm-list-row" href={`/admin/users/${t.user_id}`}><span className="grow zadm-trunc">{t.email}</span><b>{fmtNumber(t.balance)}</b></Link>
              ))}
            </div>
          ) : <Empty title="Nobody holds credits yet" />}
        </Card>
      </div>
      <Card title="Recent ledger entries" flush>
        {d.recent.length ? (
          <div className="zadm-table-wrap"><table className="zadm-table">
            <thead><tr><th>Time</th><th>User</th><th>Reason</th><th>Type</th><th className="num">Credits</th></tr></thead>
            <tbody>{d.recent.map((l: any) => (
              <tr key={l.id}><td className="nowrap">{fmtDateTime(l.created_at)}</td><td><Link className="zadm-row-link" href={`/admin/users/${l.user_id}`}>{l.email}</Link></td>
                <td>{humanize(l.reason)}</td><td><Badge tone={l.entry_type === "earn" ? "good" : l.entry_type === "spend" ? "info" : "warn"}>{humanize(l.entry_type)}</Badge></td>
                <td className="num">{l.amount > 0 ? "+" : ""}{l.amount}</td></tr>
            ))}</tbody>
          </table></div>
        ) : <Empty title="No credit activity yet" />}
      </Card>
    </>
  );
}
