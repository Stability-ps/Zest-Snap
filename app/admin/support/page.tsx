import Link from "next/link";
import { Inbox, LifeBuoy, MessageSquare } from "lucide-react";
import { adminRpc, getAdmin } from "@/lib/admin/server";
import { can } from "@/lib/admin/permissions";
import { fmtDate, fmtDateTime, fmtNumber, fmtRelative, humanize } from "@/lib/admin/format";
import { Badge, Card, Chips, DevDetails, Empty, LoadError, PageHeader, PlanBadge, StatusBadge } from "../_components/ui";
import { ActionForm, SubmitButton } from "../_components/forms";
import { replyTicket, updateTicket } from "../actions";
import { linkWith, pageOf, readParams, type SearchParams } from "../_components/page-utils";

export const metadata = { title: "Support" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const statuses = [["active", "Active"], ["new", "New"], ["open", "Open"], ["waiting", "Waiting on user"], ["resolved", "Resolved"], ["closed", "Closed"], ["all", "All"]] as const;
const priorities = ["low", "normal", "high", "urgent"];
const categories = ["account", "billing", "scan", "planner", "reminder", "calendar", "app", "suggestion", "other"];
const categoryLabel = (c: string) => (c === "scan" ? "Scan problem" : c === "app" ? "App issue" : humanize(c));
const PAGE = 50;

export default async function SupportPage({ searchParams }: { searchParams: SearchParams }) {
  const admin = await getAdmin();
  const params = await readParams(searchParams);
  const status = statuses.some(([k]) => k === params.status) ? params.status : "active";
  const priority = priorities.includes(params.priority || "") ? params.priority : null;
  const category = categories.includes(params.category || "") ? params.category : null;
  const mine = params.mine === "1";
  const selected = UUID.test(params.t || "") ? params.t : null;
  const page = pageOf(params);
  const [list, ticket, admins] = await Promise.all([
    adminRpc<any>("admin_tickets", { p_status: status === "all" ? null : status, p_priority: priority, p_category: category, p_q: params.q || null, p_mine: mine, p_limit: PAGE, p_offset: page * PAGE }),
    selected ? adminRpc<any>("admin_ticket", { p_id: selected }) : Promise.resolve(null),
    adminRpc<any[]>("admin_admins"),
  ]);
  const canAct = can(admin.role, "support");
  const head = <PageHeader title="Support Inbox" description="Conversations with Zest Snap users. Replies appear in the person's Settings → Contact support." actions={<Link className="ad-btn" href="/admin/exports?dataset=tickets">Export tickets</Link>} />;
  if (list.error) return <>{head}<Card><LoadError error={list.error} retryHref="/admin/support" /></Card></>;
  const counts = list.data.counts || {};
  const t = ticket?.data?.ticket;
  const u = ticket?.data?.user;
  return (
    <>
      {head}
      <Card flush>
        <form className="ad-toolbar" action="/admin/support">
          <input className="ad-input" type="search" name="q" defaultValue={params.q || ""} placeholder="Subject, #number, tag or e-mail" aria-label="Search tickets" />
          <input type="hidden" name="status" value={status} />
          <select className="ad-select" name="priority" defaultValue={priority || ""} aria-label="Priority">
            <option value="">Any priority</option>{priorities.map((p) => <option key={p} value={p}>{humanize(p)}</option>)}
          </select>
          <select className="ad-select" name="category" defaultValue={category || ""} aria-label="Category">
            <option value="">Any category</option>{categories.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
          </select>
          <label className="ad-check"><input type="checkbox" name="mine" value="1" defaultChecked={mine} /> Assigned to me</label>
          <button className="ad-btn">Filter</button>
        </form>
        <div style={{ padding: "12px 18px" }}>
          <Chips current={status!} items={statuses.map(([k, l]) => ({
            key: k, label: l, href: linkWith("/admin/support", params, { status: k === "active" ? null : k, t: null }),
            count: k === "active" ? ["new", "open", "waiting"].reduce((a, s) => a + Number(counts[s] || 0), 0) : k === "all" ? undefined : Number(counts[k] || 0),
          }))} />
        </div>
        <div className="ad-inbox" style={{ borderTop: "1px solid var(--ad-line)" }}>
          <div className="ad-inbox-list" aria-label="Tickets">
            {!list.data.rows.length ? (
              <Empty title={status === "active" ? "Inbox zero" : "No tickets"} icon={<Inbox aria-hidden />}>{status === "active" ? "No open conversations right now." : "Nothing matches these filters."}</Empty>
            ) : list.data.rows.map((r: any) => (
              <Link key={r.id} className="ad-inbox-item" href={linkWith("/admin/support", params, { t: r.id, page: page || null })} aria-current={r.id === selected ? "true" : undefined}>
                <span className="top"><span>#{r.number} · {r.email || "Deleted user"}</span><span>{fmtRelative(r.last_message_at)}</span></span>
                <b>{r.subject}</b>
                {r.preview && <p>{r.preview}</p>}
                <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  <StatusBadge status={r.status} />
                  {r.priority !== "normal" && <StatusBadge status={r.priority} />}
                  <Badge>{categoryLabel(r.category)}</Badge>
                  {(r.tags || []).map((tag: string) => <Badge key={tag} tone="info">#{tag}</Badge>)}
                </span>
              </Link>
            ))}
            {Number(list.data.total) > (page + 1) * PAGE && <div style={{ padding: 12 }}><Link className="ad-btn ad-btn-sm" href={linkWith("/admin/support", params, { page: page + 1 })}>Load older</Link></div>}
          </div>

          <div className="ad-convo">
            {!selected ? (
              <Empty title="Select a conversation" icon={<MessageSquare aria-hidden />}>Choose a ticket on the left to read and reply.</Empty>
            ) : ticket?.error ? <LoadError error={ticket.error} /> : !t ? <Empty title="Ticket not found" /> : (
              <>
                <div className="ad-convo-head">
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <div><h2 style={{ fontSize: 16 }}>{t.subject}</h2><span className="ad-sub">#{t.number} · opened {fmtDateTime(t.created_at)}{t.assignee_email ? ` · assigned to ${t.assignee_email}` : " · unassigned"}</span></div>
                    <div style={{ display: "flex", gap: 4 }}><StatusBadge status={t.status} /><StatusBadge status={t.priority} /></div>
                  </div>
                </div>
                <div className="ad-thread">
                  {ticket.data.messages.map((m: any) => (
                    <div key={m.id} className={`ad-msg${m.internal ? " internal" : m.from_staff ? " staff" : ""}`}>
                      <small>{m.internal ? "Internal note · " : ""}{m.from_staff ? m.author_email || "Zest team" : t.email || "User"} · {fmtDateTime(m.created_at)}</small>
                      {m.body}
                    </div>
                  ))}
                </div>
                {canAct && (
                  <ActionForm action={replyTicket} className="ad-composer" resetOnSuccess>
                    <input type="hidden" name="id" value={t.id} />
                    <textarea className="ad-textarea" name="body" required maxLength={5000} placeholder="Write a reply…" aria-label="Message" />
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <div style={{ display: "flex", gap: 14 }}>
                        <label className="ad-check"><input type="radio" name="mode" value="reply" defaultChecked /> Reply to user</label>
                        <label className="ad-check"><input type="radio" name="mode" value="note" /> Internal note</label>
                      </div>
                      <SubmitButton pendingLabel="Sending…">Send</SubmitButton>
                    </div>
                    <span className="ad-sub">Replies show in the app. E-mail notifications aren&apos;t configured yet, so the person sees your reply next time they open Contact support.</span>
                  </ActionForm>
                )}
              </>
            )}
          </div>

          <aside className="ad-inbox-side" aria-label="Ticket details">
            {t ? (
              <>
                <div>
                  <h3 style={{ fontSize: 13, marginBottom: 8 }}>Person</h3>
                  {u ? (
                    <dl className="ad-kv">
                      <dt>E-mail</dt><dd><Link className="ad-row-link" href={`/admin/users/${u.id}`}>{t.email}</Link></dd>
                      <dt>Plan</dt><dd><PlanBadge plan={u.plan} /></dd>
                      <dt>Joined</dt><dd>{fmtDate(u.created_at)}</dd>
                      <dt>Scans</dt><dd>{fmtNumber(u.scans)}{u.last_scan_failed ? <Badge tone="bad">Last failed</Badge> : null}</dd>
                      <dt>Tickets</dt><dd>{fmtNumber(u.tickets)}</dd>
                      <dt>Account</dt><dd><StatusBadge status={u.account_status} />{u.support_flag && <Badge tone="warn">Support</Badge>}</dd>
                    </dl>
                  ) : <p className="ad-sub">Account deleted.</p>}
                </div>
                {Object.keys(t.context || {}).length > 0 && (
                  <div>
                    <h3 style={{ fontSize: 13, marginBottom: 8 }}>App context</h3>
                    <dl className="ad-kv">
                      {t.context.route && <><dt>Page</dt><dd className="ad-mono">{t.context.route}</dd></>}
                      {t.context.appVersion && <><dt>Version</dt><dd className="ad-mono">{t.context.appVersion}</dd></>}
                      {t.context.timezone && <><dt>Timezone</dt><dd>{t.context.timezone}</dd></>}
                      {t.context.userAgent && <><dt>Device</dt><dd style={{ fontSize: 12, fontWeight: 500 }}>{t.context.userAgent}</dd></>}
                    </dl>
                  </div>
                )}
                <ActionForm key={`${t.id}:${t.updated_at}`} action={updateTicket} className="ad-grid" inline>
                  <input type="hidden" name="id" value={t.id} />
                  <h3 style={{ fontSize: 13 }}>Ticket</h3>
                  <label className="ad-field">Status
                    <select className="ad-select" name="status" defaultValue={t.status} disabled={!canAct}>
                      {statuses.filter(([k]) => !["active", "all"].includes(k)).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </label>
                  <label className="ad-field">Priority
                    <select className="ad-select" name="priority" defaultValue={t.priority} disabled={!canAct}>{priorities.map((p) => <option key={p} value={p}>{humanize(p)}</option>)}</select>
                  </label>
                  <label className="ad-field">Category
                    <select className="ad-select" name="category" defaultValue={t.category} disabled={!canAct}>{categories.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}</select>
                  </label>
                  <label className="ad-field">Assignee
                    <select className="ad-select" name="assignee_id" defaultValue={t.assignee_id || ""} disabled={!canAct}>
                      <option value="">Unassigned</option>
                      {(admins.data || []).map((a: any) => <option key={a.id} value={a.id}>{a.name || a.email}</option>)}
                    </select>
                  </label>
                  <label className="ad-field">Tags <small>Comma-separated</small>
                    <input className="ad-input" name="tags" defaultValue={(t.tags || []).join(", ")} disabled={!canAct} />
                  </label>
                  <SubmitButton className="ad-btn" disabled={!canAct}>Update ticket</SubmitButton>
                </ActionForm>
                <DevDetails data={{ id: t.id, number: t.number, user_id: t.user_id, first_response_at: t.first_response_at, resolved_at: t.resolved_at }} />
              </>
            ) : (
              <Empty title="No ticket selected" icon={<LifeBuoy aria-hidden />} />
            )}
          </aside>
        </div>
      </Card>
    </>
  );
}
