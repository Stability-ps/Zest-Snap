import Link from "next/link";
import { Bug } from "lucide-react";
import { adminRpc, getAdmin } from "@/lib/admin/server";
import { can } from "@/lib/admin/permissions";
import { fmtDateTime, fmtDuration, fmtRelative, humanize } from "@/lib/admin/format";
import { Badge, BarList, Card, Chips, DevDetails, Empty, LoadError, PageHeader, Pager, StatusBadge } from "../_components/ui";
import { ActionForm, SubmitButton } from "../_components/forms";
import { addReportNote, updateReport } from "../actions";
import { linkWith, pageOf, readParams, type SearchParams } from "../_components/page-utils";

export const metadata = { title: "Reports" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const statuses = [["active", "Active"], ["new", "New"], ["triaged", "Triaged"], ["in_progress", "In progress"], ["resolved", "Resolved"], ["wont_fix", "Won't fix"], ["all", "All"]] as const;
const kinds = ["bug", "broken_feature", "scan_problem", "incorrect_extraction", "reminder", "calendar", "billing", "other"];
const priorities = ["low", "normal", "high", "urgent"];
const PAGE = 50;

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const admin = await getAdmin();
  const params = await readParams(searchParams);
  const status = statuses.some(([k]) => k === params.status) ? params.status : "active";
  const kind = kinds.includes(params.kind || "") ? params.kind : null;
  const selected = UUID.test(params.r || "") ? params.r : null;
  const page = pageOf(params);
  const [list, detail, admins] = await Promise.all([
    adminRpc<any>("admin_reports", { p_status: status === "all" ? null : status, p_kind: kind, p_priority: null, p_q: params.q || null, p_limit: PAGE, p_offset: page * PAGE }),
    selected ? adminRpc<any>("admin_report", { p_id: selected }) : Promise.resolve(null),
    adminRpc<any[]>("admin_admins"),
  ]);
  const canAct = can(admin.role, "support");
  const head = <PageHeader title="Reports & Issues" description="Problems people report from Settings → Report a problem." actions={<Link className="zadm-btn" href="/admin/exports?dataset=reports">Export reports</Link>} />;
  if (list.error) return <>{head}<Card><LoadError error={list.error} retryHref="/admin/reports" /></Card></>;
  const r = detail?.data?.report;
  const counts = list.data.counts || {};
  return (
    <>
      {head}
      <div className="zadm-grid zadm-grid-21">
        <Card flush>
          <form className="zadm-toolbar" action="/admin/reports">
            <input className="zadm-input" type="search" name="q" defaultValue={params.q || ""} placeholder="Description, #number or request ID" aria-label="Search reports" />
            <input type="hidden" name="status" value={status} />
            <select className="zadm-select" name="kind" defaultValue={kind || ""} aria-label="Type">
              <option value="">All types</option>{kinds.map((k) => <option key={k} value={k}>{humanize(k)}</option>)}
            </select>
            <button className="zadm-btn">Filter</button>
          </form>
          <div style={{ padding: "12px 18px" }}>
            <Chips current={status!} items={statuses.map(([k, l]) => ({ key: k, label: l, href: linkWith("/admin/reports", params, { status: k === "active" ? null : k, r: null }),
              count: k === "active" ? ["new", "triaged", "in_progress"].reduce((a, s) => a + Number(counts[s] || 0), 0) : k === "all" ? undefined : Number(counts[k] || 0) }))} />
          </div>
          {!list.data.rows.length ? <Empty title="No reports" icon={<Bug aria-hidden />}>Nothing matches these filters.</Empty> : (
            <>
              <div className="zadm-table-wrap"><table className="zadm-table">
                <thead><tr><th>#</th><th>Reported</th><th>Type</th><th>Description</th><th>Priority</th><th>Status</th></tr></thead>
                <tbody>{list.data.rows.map((x: any) => (
                  <tr key={x.id} style={x.id === selected ? { background: "var(--zadm-teal-soft)" } : undefined}>
                    <td><Link className="zadm-row-link" href={linkWith("/admin/reports", params, { r: x.id, page: page || null })}>#{x.number}</Link></td>
                    <td className="nowrap">{fmtRelative(x.created_at)}<span className="zadm-sub">{x.email || "Deleted user"}</span></td>
                    <td>{humanize(x.kind)}</td>
                    <td><Link href={linkWith("/admin/reports", params, { r: x.id, page: page || null })} className="zadm-trunc" style={{ maxWidth: 300 }}>{x.description}</Link></td>
                    <td><StatusBadge status={x.priority} /></td><td><StatusBadge status={x.status} /></td>
                  </tr>
                ))}</tbody>
              </table></div>
              <Pager total={Number(list.data.total)} page={page} pageSize={PAGE} href={(p) => linkWith("/admin/reports", params, { page: p || null })} />
            </>
          )}
        </Card>
        <div className="zadm-grid" style={{ alignContent: "start" }}>
          {r ? (
            <Card title={`Report #${r.number}`} description={`${humanize(r.kind)} · ${fmtDateTime(r.created_at)}`}>
              <p style={{ whiteSpace: "pre-wrap", marginTop: 0 }}>{r.description}</p>
              <dl className="zadm-kv">
                <dt>From</dt><dd>{r.user_id ? <Link className="zadm-row-link" href={`/admin/users/${r.user_id}`}>{r.email}</Link> : "Deleted user"}</dd>
                <dt>Page</dt><dd className="zadm-mono">{r.route || "—"}</dd>
                <dt>App version</dt><dd className="zadm-mono">{r.app_version || "—"}</dd>
                <dt>Device</dt><dd style={{ fontSize: 12, fontWeight: 500 }}>{r.user_agent || "—"}</dd>
                <dt>Request ID</dt><dd>{r.request_id ? <Link className="zadm-mono" href={`/admin/scans?request=${r.request_id}`}>{r.request_id}</Link> : "—"}</dd>
                {detail?.data?.scan && <><dt>Scan</dt><dd><StatusBadge status={detail.data.scan.status} /> {detail.data.scan.error_code ? <Badge tone="bad">{humanize(detail.data.scan.error_code)}</Badge> : null} {fmtDuration(detail.data.scan.duration_ms)}</dd></>}
                <dt>Screenshot</dt><dd className="zadm-sub" style={{ display: "inline" }}>Not collected (privacy)</dd>
              </dl>
              <ActionForm key={`${r.id}:${r.updated_at}`} action={updateReport} className="zadm-form-grid" inline>
                <input type="hidden" name="id" value={r.id} />
                <label className="zadm-field">Status
                  <select className="zadm-select" name="status" defaultValue={r.status} disabled={!canAct}>{statuses.filter(([k]) => !["active", "all"].includes(k)).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                </label>
                <label className="zadm-field">Priority
                  <select className="zadm-select" name="priority" defaultValue={r.priority} disabled={!canAct}>{priorities.map((p) => <option key={p} value={p}>{humanize(p)}</option>)}</select>
                </label>
                <label className="zadm-field full">Assignee
                  <select className="zadm-select" name="assignee_id" defaultValue={r.assignee_id || ""} disabled={!canAct}>
                    <option value="">Unassigned</option>{(admins.data || []).map((a: any) => <option key={a.id} value={a.id}>{a.name || a.email}</option>)}
                  </select>
                </label>
                <div className="full"><SubmitButton className="zadm-btn" disabled={!canAct}>Update report</SubmitButton></div>
              </ActionForm>
              <h3 style={{ fontSize: 13, margin: "18px 0 8px" }}>Internal notes</h3>
              <div className="zadm-thread" style={{ padding: 0, maxHeight: 260 }}>
                {detail.data.notes.length ? detail.data.notes.map((n: any) => (
                  <div className="zadm-msg internal" key={n.id} style={{ maxWidth: "100%", justifySelf: "stretch" }}><small>{n.author_email} · {fmtDateTime(n.created_at)}</small>{n.body}</div>
                )) : <p className="zadm-sub">No notes yet.</p>}
              </div>
              {canAct && (
                <ActionForm action={addReportNote} className="zadm-grid" resetOnSuccess>
                  <input type="hidden" name="id" value={r.id} />
                  <textarea className="zadm-textarea" name="body" required maxLength={4000} placeholder="Add an internal note (not visible to the user)" aria-label="Internal note" style={{ marginTop: 10 }} />
                  <SubmitButton className="zadm-btn">Add note</SubmitButton>
                </ActionForm>
              )}
              <DevDetails data={r} />
            </Card>
          ) : (
            <Card title="Open reports by type">
              <BarList data={Object.entries(list.data.by_kind || {}).map(([k, v]) => ({ key: k, label: humanize(k), value: Number(v) }))} empty="No open reports." />
              <p className="zadm-sub" style={{ marginTop: 14 }}>Select a report to triage it.</p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
