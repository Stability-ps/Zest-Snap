import Link from "next/link";
import { Download, ScanLine } from "lucide-react";
import { adminRpc, iso } from "@/lib/admin/server";
import { fmtDateTime, fmtDuration, fmtNumber, fmtPercent, humanize, ratio } from "@/lib/admin/format";
import { Badge, Card, Chips, DevDetails, Empty, LoadError, Notice, PageHeader, Pager, Stats, StatusBadge } from "../_components/ui";
import { linkWith, pageOf, readParams, rangeFrom, type SearchParams } from "../_components/page-utils";

export const metadata = { title: "Scans" };
const PAGE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ScansPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await readParams(searchParams);
  const range = rangeFrom(params);
  const page = pageOf(params);
  const status = ["completed", "failed", "reserved"].includes(params.status || "") ? params.status : null;
  const kind = ["pdf", "image", "unknown"].includes(params.kind || "") ? params.kind : null;
  const source = ["account", "guest"].includes(params.source || "") ? params.source : null;
  const user = UUID.test(params.user || "") ? params.user : null;
  const request = UUID.test(params.request || "") ? params.request!.toLowerCase() : null;
  const res = await adminRpc<any>("admin_scans", {
    p_from: iso(range.from), p_to: iso(range.to), p_status: request ? null : status, p_kind: request ? null : kind, p_source: request ? null : source,
    p_user: request ? null : user, p_limit: PAGE, p_offset: request ? 0 : page * PAGE, p_request: request,
  });
  const rows: any[] = res.data?.rows || [];
  const s = res.data?.stats;
  const total = Number(res.data?.total || 0);
  return (
    <>
      <PageHeader title="Scans" description={`Every AI scan request · ${request ? "single request" : range.label}. Metadata only — original documents are never kept.`}
        actions={<Link className="ad-btn" href="/admin/exports?dataset=scans"><Download aria-hidden /> Export scans</Link>} />
      {res.error ? <Card><LoadError error={res.error} retryHref="/admin/scans" /></Card> : (
        <>
          {!request && <Stats items={[
            { label: "Scans", value: total },
            { label: "Succeeded", value: Number(s.completed) },
            { label: "Failed", value: Number(s.failed) },
            { label: "Success rate", value: fmtPercent(ratio(s.completed, Number(s.completed) + Number(s.failed))) },
            { label: "Avg events found", value: s.avg_events === null ? "—" : fmtNumber(s.avg_events, 1) },
            { label: "Avg duration", value: fmtDuration(s.avg_duration_ms) },
          ]} />}
          <Card flush>
            <div className="ad-toolbar" style={{ display: "grid", gap: 10 }}>
              <Chips current={status || ""} items={[["", "All"], ["completed", "Succeeded"], ["failed", "Failed"], ["reserved", "In progress"]].map(([k, l]) => ({ key: k, label: l, href: linkWith("/admin/scans", params, { status: k || null, request: null }) }))} />
              <Chips current={kind || ""} items={[["", "All types"], ["pdf", "PDF"], ["image", "Image"], ["unknown", "Not recorded"]].map(([k, l]) => ({ key: k, label: l, href: linkWith("/admin/scans", params, { kind: k || null, request: null }) }))} />
              <Chips current={source || ""} items={[["", "All sources"], ["account", "Signed-in"], ["guest", "Guest trial"]].map(([k, l]) => ({ key: k, label: l, href: linkWith("/admin/scans", params, { source: k || null, request: null }) }))} />
              {(user || request) && <div><Badge tone="info">{user ? "Filtered to one user" : "Single request"}</Badge> <Link className="ad-btn ad-btn-sm ad-btn-ghost" href="/admin/scans">Clear</Link></div>}
            </div>
            <div style={{ marginTop: 12 }}>
              {!rows.length ? (
                <Empty title="No scans match" icon={<ScanLine aria-hidden />}>Try a wider date range or fewer filters.</Empty>
              ) : (
                <>
                  <div className="ad-table-wrap"><table className="ad-table">
                    <thead><tr><th>Time</th><th>User</th><th>Type</th><th>Status</th><th className="num">Events</th><th className="num">Warnings</th><th className="num">Duration</th><th>Error</th><th>Request ID</th></tr></thead>
                    <tbody>{rows.map((r) => (
                      <tr key={r.id}>
                        <td className="nowrap">{fmtDateTime(r.created_at)}</td>
                        <td>{r.user_id ? <Link className="ad-row-link" href={`/admin/users/${r.user_id}`}>{r.email || "User"}</Link> : <Badge>Guest</Badge>}</td>
                        <td>{r.mime_type ? (r.mime_type === "application/pdf" ? "PDF" : humanize(r.mime_type.replace("image/", ""))) : <span className="ad-sub">Not recorded</span>}{r.page_count ? <span className="ad-sub">{r.page_count} pages</span> : null}</td>
                        <td><StatusBadge status={r.status} /></td>
                        <td className="num">{r.event_count ?? "—"}</td>
                        <td className="num">{r.warning_count ?? "—"}</td>
                        <td className="num">{fmtDuration(r.duration_ms)}</td>
                        <td>{r.error_code ? <Badge tone="bad">{humanize(r.error_code)}</Badge> : "—"}</td>
                        <td><Link className="ad-mono" href={linkWith("/admin/scans", {}, { request: r.id })}>{String(r.id).slice(0, 8)}…</Link></td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                  {request && rows[0] && <DevDetails data={rows[0]} />}
                  {!request && <Pager total={total} page={page} pageSize={PAGE} href={(p) => linkWith("/admin/scans", params, { page: p || null })} />}
                </>
              )}
            </div>
          </Card>
          <Notice>Duration, type, event count and error details are recorded for scans from this release onward; older rows show “—”.</Notice>
        </>
      )}
    </>
  );
}
