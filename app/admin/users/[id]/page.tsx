import Link from "next/link";
import { notFound } from "next/navigation";
import { Ban, CreditCard, Flag, Gift, RotateCcw } from "lucide-react";
import { adminRpc, getAdmin } from "@/lib/admin/server";
import { can } from "@/lib/admin/permissions";
import { fmtDate, fmtDateTime, fmtDuration, fmtNumber, fmtRelative, humanize } from "@/lib/admin/format";
import { Badge, Card, DevDetails, Empty, LoadError, PageHeader, PlanBadge, Stats, StatusBadge } from "../../_components/ui";
import { ModalForm } from "../../_components/forms";
import { adjustCredits, setAccountStatus, setSupportFlag, setUserPlan } from "../../actions";

export const metadata = { title: "User" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function UserDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const admin = await getAdmin();
  const [res, config] = await Promise.all([adminRpc<any>("admin_user_detail", { p_user: id }), adminRpc<any>("admin_config")]);
  if (res.error) return <><PageHeader title="User" crumbs={[{ href: "/admin/users", label: "Users" }, { label: "User" }]} /><Card><LoadError error={res.error} retryHref={`/admin/users/${id}`} /></Card></>;
  if (!res.data) notFound();
  const d = res.data;
  const p = d.profile;
  const operate = can(admin.role, "operate");
  const isSelf = p.id === admin.userId;
  const activePlans = (config.data?.plans || []).filter((x: any) => x.active);

  return (
    <>
      <PageHeader
        crumbs={[{ href: "/admin/users", label: "Users" }, { label: p.name || p.email || "User" }]}
        title={p.name || p.email || "Unnamed user"}
        description={<span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {p.email} <PlanBadge plan={p.plan} /> <StatusBadge status={p.account_status} />
          {p.is_admin && <Badge tone="navy">{humanize(p.admin_role || "admin")}</Badge>}
          {p.support_flag && <Badge tone="warn" icon={<Flag aria-hidden />}>Support</Badge>}
          {!p.email_confirmed && <Badge tone="warn">E-mail unconfirmed</Badge>}
        </span>}
        actions={<>
          <ModalForm trigger={<><Gift aria-hidden /> Credits</>} title="Adjust Zest Credits" description={`Current balance: ${fmtNumber(d.credits)} credits. Every adjustment is logged.`}
            action={adjustCredits} submitLabel="Apply adjustment" disabled={!operate}>
            <input type="hidden" name="user" value={p.id} />
            <div className="ad-form-grid">
              <label className="ad-field">Action
                <select className="ad-select" name="direction" defaultValue="add"><option value="add">Add credits</option><option value="revoke">Revoke credits</option></select>
              </label>
              <label className="ad-field">Amount
                <input className="ad-input" name="amount" type="number" min={1} max={1000} required defaultValue={5} />
              </label>
              <label className="ad-field full">Reason <small>Shown in the audit log</small>
                <input className="ad-input" name="reason" required minLength={3} maxLength={200} placeholder="e.g. Goodwill after failed scans" />
              </label>
            </div>
          </ModalForm>
          <ModalForm trigger={<><CreditCard aria-hidden /> Plan</>} title="Change plan" description="An administrative override. It does not create or charge a subscription." action={setUserPlan} submitLabel="Change plan" disabled={!operate}>
            <input type="hidden" name="user" value={p.id} />
            <label className="ad-field">Plan
              <select className="ad-select" name="plan" defaultValue={p.plan}>
                {activePlans.map((x: any) => <option key={x.id} value={x.id}>{x.name || x.id}</option>)}
              </select>
              <small>Only active plans are listed — scanning requires an active plan.</small>
            </label>
            <label className="ad-field">Reason
              <input className="ad-input" name="reason" required minLength={3} maxLength={200} placeholder="e.g. Partner account" />
            </label>
          </ModalForm>
          <ModalForm trigger={<><Flag aria-hidden /> {p.support_flag ? "Edit support mark" : "Mark for support"}</>} title="Support mark"
            description="Highlights this account for the support team." action={setSupportFlag} submitLabel="Save" disabled={!can(admin.role, "support")}>
            <input type="hidden" name="user" value={p.id} />
            <label className="ad-check"><input type="checkbox" name="flag" defaultChecked /> Marked for support</label>
            <label className="ad-field">Note
              <textarea className="ad-textarea" name="note" maxLength={1000} defaultValue={p.support_note || ""} />
            </label>
          </ModalForm>
          {p.account_status === "disabled" ? (
            <ModalForm trigger={<><RotateCcw aria-hidden /> Reactivate</>} triggerClassName="ad-btn ad-btn-teal" title="Reactivate account?"
              description="They will be able to sign in again." action={setAccountStatus} submitLabel="Reactivate" disabled={!operate || isSelf}>
              <input type="hidden" name="user" value={p.id} /><input type="hidden" name="status" value="active" />
              <label className="ad-field">Reason<input className="ad-input" name="reason" required minLength={3} maxLength={200} /></label>
            </ModalForm>
          ) : (
            <ModalForm trigger={<><Ban aria-hidden /> Disable</>} triggerClassName="ad-btn" title="Disable this account?" danger
              description="They are blocked from signing in and their sessions stop refreshing (an open session ends within the hour). Data is kept and the account can be reactivated."
              action={setAccountStatus} submitLabel="Disable account" disabled={!operate || isSelf || p.is_admin}>
              <input type="hidden" name="user" value={p.id} /><input type="hidden" name="status" value="disabled" />
              <label className="ad-field">Reason<input className="ad-input" name="reason" required minLength={3} maxLength={200} placeholder="e.g. Abuse report #123" /></label>
            </ModalForm>
          )}
        </>}
      />

      <div className="ad-grid ad-grid-3">
        <Card title="Identity">
          <dl className="ad-kv">
            <dt>User ID</dt><dd className="ad-mono">{p.id}</dd>
            <dt>Signed up</dt><dd>{fmtDateTime(p.created_at)}</dd>
            <dt>Last sign-in</dt><dd>{fmtRelative(p.last_sign_in_at)}</dd>
            <dt>Last active</dt><dd>{fmtRelative(p.last_active_at)}</dd>
            <dt>Locale</dt><dd>{p.locale || "—"}</dd>
            <dt>Timezone</dt><dd>{p.timezone || "—"}</dd>
            <dt>Country</dt><dd>{p.country_code || "Not recorded"}</dd>
            <dt>Onboarded</dt><dd>{p.onboarding_complete ? "Yes" : "No"}</dd>
            <dt>Devices</dt><dd>{fmtNumber(d.devices)} linked · {fmtNumber(d.push_devices)} push</dd>
          </dl>
          {p.support_note && <p className="ad-sub" style={{ marginTop: 12 }}><b>Support note:</b> {p.support_note}</p>}
        </Card>
        <Card title="Subscription">
          {d.subscription ? (
            <dl className="ad-kv">
              <dt>Plan</dt><dd><PlanBadge plan={d.subscription.plan} /></dd>
              <dt>Status</dt><dd><StatusBadge status={d.subscription.status} /></dd>
              <dt>Provider</dt><dd>{d.subscription.provider || "—"}</dd>
              <dt>Renews</dt><dd>{fmtDate(d.subscription.current_period_end)}</dd>
              <dt>Cancels</dt><dd>{d.subscription.cancel_at_period_end ? "At period end" : "No"}</dd>
            </dl>
          ) : (
            <Empty title="No subscription">Current plan: {humanize(p.plan)}. Billing history appears here once payments are connected.</Empty>
          )}
          {d.payments.length > 0 && (
            <div className="ad-table-wrap" style={{ marginTop: 12 }}>
              <table className="ad-table"><tbody>
                {d.payments.map((t: any) => <tr key={t.id}><td>{fmtDate(t.occurred_at)}</td><td>{humanize(t.kind)}</td><td><StatusBadge status={t.status} /></td><td className="num">{(t.amount_cents / 100).toFixed(2)} {t.currency}</td></tr>)}
              </tbody></table>
            </div>
          )}
        </Card>
        <Card title="Usage this month">
          <Stats items={[
            { label: "AI scans", value: `${fmtNumber(d.current_usage?.ai_scans ?? 0)} / ${fmtNumber((d.allowance ?? 0) + (d.current_usage?.bonus_scans ?? 0))}` },
            { label: "PDF pages", value: Number(d.current_usage?.pdf_pages ?? 0) },
            { label: "AI requests (all time)", value: Number(d.ai_requests) },
            { label: "Saved scans", value: Number(d.saved_scans) },
          ]} />
        </Card>
      </div>

      <div className="ad-grid ad-grid-2">
        <Card title="Planner & reminders">
          <Stats items={[
            { label: "Planner items", value: Number(d.planner?.total ?? 0) },
            { label: "Events", value: Number(d.planner?.events ?? 0) },
            { label: "Tasks", value: Number(d.planner?.tasks ?? 0) },
            { label: "Deadlines", value: Number(d.planner?.deadlines ?? 0) },
            { label: "Upcoming", value: Number(d.planner?.upcoming ?? 0) },
            { label: "Overdue", value: Number(d.planner?.overdue ?? 0) },
            { label: "Completed", value: Number(d.planner?.completed ?? 0) },
            { label: "Reminders", value: Number(d.reminders?.total ?? 0) },
            { label: "Reminders sent", value: Number(d.reminders?.sent ?? 0) },
            { label: "Reminder failures", value: Number(d.reminders?.failed ?? 0) },
          ]} />
          <div style={{ marginTop: 14 }}>
            <b style={{ fontSize: 13 }}>Calendar</b>
            {d.calendar.length ? d.calendar.map((c: any) => (
              <p key={c.provider} style={{ margin: "6px 0 0" }}><Badge tone="good">{humanize(c.provider)}</Badge> <span className="ad-sub" style={{ display: "inline" }}>connected {fmtDate(c.connected_at)}{c.last_sync_at ? ` · last sync ${fmtRelative(c.last_sync_at)}` : ""}</span></p>
            )) : <p className="ad-sub" style={{ marginTop: 6 }}>No direct calendar connection.</p>}
          </div>
        </Card>
        <Card title="Rewards & referrals" description={`Balance ${fmtNumber(d.credits)} credits${d.referral_code ? ` · invite code ${d.referral_code}` : ""}`}>
          {d.referred_by && <p style={{ marginTop: 0 }}>Referred by <Link className="ad-row-link" href={`/admin/users/${d.referred_by.user_id}`}>{d.referred_by.email}</Link> <StatusBadge status={d.referred_by.status} /></p>}
          {d.referrals_sent.length > 0 && <p style={{ marginTop: 0 }}>Invited {d.referrals_sent.length}: {d.referrals_sent.filter((r: any) => ["qualified", "rewarded"].includes(r.status)).length} qualified</p>}
          {d.ledger.length ? (
            <div className="ad-table-wrap" style={{ maxHeight: 280 }}>
              <table className="ad-table">
                <thead><tr><th>Date</th><th>Reason</th><th>Type</th><th className="num">Credits</th></tr></thead>
                <tbody>{d.ledger.map((l: any) => (
                  <tr key={l.id}><td className="nowrap">{fmtDate(l.created_at)}</td><td>{humanize(l.reason)}</td><td><Badge tone={l.type === "earn" ? "good" : l.type === "spend" ? "info" : "warn"}>{humanize(l.type)}</Badge></td>
                    <td className="num" style={{ color: l.amount < 0 ? "var(--ad-bad)" : undefined }}>{l.amount > 0 ? "+" : ""}{l.amount}</td></tr>
                ))}</tbody>
              </table>
            </div>
          ) : <Empty title="No credit activity yet" />}
        </Card>
      </div>

      <Card title="Recent scans" description="Operational metadata only — Zest Snap does not keep the original documents." flush>
        {d.scans.length ? (
          <div className="ad-table-wrap">
            <table className="ad-table">
              <thead><tr><th>Time</th><th>Status</th><th>Type</th><th className="num">Pages</th><th className="num">Events</th><th className="num">Warnings</th><th className="num">Duration</th><th>Error</th><th>Request ID</th></tr></thead>
              <tbody>{d.scans.map((s: any) => (
                <tr key={s.id}>
                  <td className="nowrap">{fmtDateTime(s.created_at)}</td><td><StatusBadge status={s.status} /></td><td>{s.mime_type || "—"}</td>
                  <td className="num">{s.page_count ?? "—"}</td><td className="num">{s.event_count ?? "—"}</td><td className="num">{s.warning_count ?? "—"}</td>
                  <td className="num">{fmtDuration(s.duration_ms)}</td><td>{s.error_code ? <Badge tone="bad">{humanize(s.error_code)}</Badge> : "—"}</td>
                  <td><Link className="ad-mono" href={`/admin/scans?request=${s.id}`}>{s.id.slice(0, 8)}…</Link></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <Empty title="No AI scans yet" />}
      </Card>

      <div className="ad-grid ad-grid-2">
        <Card title="Support history">
          {!d.tickets.length && !d.reports.length && !d.feedback.length ? <Empty title="No support history" /> : (
            <div className="ad-list" style={{ margin: "-6px -18px -10px" }}>
              {d.tickets.map((t: any) => <Link key={t.id} className="ad-list-row" href={`/admin/support?t=${t.id}`}><Badge tone="info">Ticket #{t.number}</Badge><span className="grow ad-trunc">{t.subject}</span><StatusBadge status={t.status} /></Link>)}
              {d.reports.map((r: any) => <Link key={r.id} className="ad-list-row" href={`/admin/reports?r=${r.id}`}><Badge tone="warn">Report #{r.number}</Badge><span className="grow">{humanize(r.kind)}</span><StatusBadge status={r.status} /></Link>)}
              {d.feedback.map((f: any) => <Link key={f.id} className="ad-list-row" href="/admin/feedback"><Badge>{f.rating ? `${f.rating}★` : "Feedback"}</Badge><span className="grow ad-trunc">{f.feedback || "Rating only"}</span><StatusBadge status={f.status} /></Link>)}
            </div>
          )}
        </Card>
        <Card title="Audit trail" description="Admin actions on this account">
          {d.audit.length ? (
            <div className="ad-list" style={{ margin: "-6px -18px -10px" }}>
              {d.audit.map((a: any, i: number) => (
                <div key={i} className="ad-list-row">
                  <span className="grow"><b>{humanize(a.action.replace(".", " "))}</b><span className="ad-sub">{a.admin_email || "Admin"} · {fmtDateTime(a.created_at)}{a.after?.reason ? ` · “${a.after.reason}”` : ""}</span></span>
                </div>
              ))}
            </div>
          ) : <Empty title="No admin actions recorded" />}
        </Card>
      </div>
      <Card title="Monthly usage history" flush>
        {d.usage.length ? (
          <div className="ad-table-wrap"><table className="ad-table">
            <thead><tr><th>Month</th><th className="num">AI scans</th><th className="num">Bonus scans</th><th className="num">PDF pages</th><th className="num">Est. AI cost</th></tr></thead>
            <tbody>{d.usage.map((u: any) => <tr key={u.period_start}><td>{String(u.period_start).slice(0, 7)}</td><td className="num">{u.ai_scans}</td><td className="num">{u.bonus_scans}</td><td className="num">{u.pdf_pages}</td><td className="num">{Number(u.estimated_cost_usd) ? `$${Number(u.estimated_cost_usd).toFixed(4)}` : "—"}</td></tr>)}</tbody>
          </table></div>
        ) : <Empty title="No usage recorded yet" />}
        <DevDetails data={{ profile: p, subscription: d.subscription, current_usage: d.current_usage }} />
      </Card>
    </>
  );
}
