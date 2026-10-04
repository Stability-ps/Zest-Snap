import Link from "next/link";
import { ScrollText } from "lucide-react";
import { adminRpc, iso } from "@/lib/admin/server";
import { fmtDateTime, humanize } from "@/lib/admin/format";
import { Badge, Card, Chips, Empty, LoadError, PageHeader, Pager } from "../_components/ui";
import { linkWith, pageOf, readParams, rangeFrom, type SearchParams } from "../_components/page-utils";

export const metadata = { title: "Audit Log" };
const PAGE = 50;

function Change({ before, after }: { before: any; after: any }) {
  const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])].filter((k) => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]));
  if (!keys.length) return <span className="ad-sub">—</span>;
  const show = (v: unknown) => (v === null || v === undefined ? "∅" : typeof v === "object" ? JSON.stringify(v) : String(v));
  return (
    <span style={{ display: "grid", gap: 2 }}>
      {keys.slice(0, 6).map((k) => (
        <span key={k} style={{ fontSize: 12 }}><b>{humanize(k)}:</b> {before && k in before ? <><s style={{ color: "var(--ad-muted)" }}>{show(before[k])}</s> → </> : null}{show(after?.[k])}</span>
      ))}
      {keys.length > 6 && <span className="ad-sub">+{keys.length - 6} more</span>}
    </span>
  );
}

const objectLink = (type: string, id: string | null) =>
  !id ? null : type === "user" ? `/admin/users/${id}` : type === "ticket" ? `/admin/support?t=${id}` : type === "report" ? `/admin/reports?r=${id}`
    : type === "plan" ? "/admin/plans" : type === "feature_flag" ? "/admin/flags" : type === "admin" ? `/admin/users/${id}` : null;

export default async function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await readParams(searchParams);
  const range = rangeFrom(params);
  const page = pageOf(params);
  const res = await adminRpc<any>("admin_audit", { p_q: params.q || null, p_type: params.type || null, p_from: iso(range.from), p_to: iso(range.to), p_limit: PAGE, p_offset: page * PAGE });
  const head = <PageHeader title="Audit Log" description={`Every admin change, who made it and what changed · ${range.label}`} actions={<Link className="ad-btn" href="/admin/exports?dataset=audit">Export</Link>} />;
  if (res.error) return <>{head}<Card><LoadError error={res.error} retryHref="/admin/audit" /></Card></>;
  const types: string[] = res.data.types || [];
  return (
    <>
      {head}
      <Card flush>
        <form className="ad-toolbar" action="/admin/audit">
          <input className="ad-input" type="search" name="q" defaultValue={params.q || ""} placeholder="Action, admin e-mail or object ID" aria-label="Search audit log" />
          {params.type && <input type="hidden" name="type" value={params.type} />}
          {params.range && <input type="hidden" name="range" value={params.range} />}
          <button className="ad-btn">Search</button>
        </form>
        {types.length > 0 && <div style={{ padding: "12px 18px 0" }}><Chips current={params.type || ""} items={[{ key: "", label: "All", href: linkWith("/admin/audit", params, { type: null }) }, ...types.map((t) => ({ key: t, label: humanize(t), href: linkWith("/admin/audit", params, { type: t }) }))]} /></div>}
        <div style={{ marginTop: 12 }}>
          {!res.data.rows.length ? <Empty title="No admin actions recorded" icon={<ScrollText aria-hidden />}>Changes made in Admin appear here automatically.</Empty> : (
            <>
              <div className="ad-table-wrap"><table className="ad-table">
                <thead><tr><th>Time</th><th>Admin</th><th>Action</th><th>Object</th><th>Change</th></tr></thead>
                <tbody>{res.data.rows.map((a: any) => {
                  const href = objectLink(a.object_type, a.object_id);
                  return (
                    <tr key={a.id}>
                      <td className="nowrap">{fmtDateTime(a.created_at)}</td>
                      <td>{a.admin_email || "—"}</td>
                      <td><Badge tone="info">{a.action}</Badge></td>
                      <td>{humanize(a.object_type)}{a.object_id && <span className="ad-sub">{href ? <Link href={href} className="ad-mono">{a.object_id.length > 20 ? a.object_id.slice(0, 8) + "…" : a.object_id}</Link> : <span className="ad-mono">{a.object_id}</span>}</span>}</td>
                      <td><Change before={a.before} after={a.after} /></td>
                    </tr>
                  );
                })}</tbody>
              </table></div>
              <Pager total={Number(res.data.total)} page={page} pageSize={PAGE} href={(p) => linkWith("/admin/audit", params, { page: p || null })} />
            </>
          )}
        </div>
      </Card>
    </>
  );
}
