import { Fragment } from "react";
import { ShieldCheck, UserPlus } from "lucide-react";
import { adminRpc, getAdmin } from "@/lib/admin/server";
import { can, roleLabels, type AdminRole } from "@/lib/admin/permissions";
import { fmtDate, fmtRelative } from "@/lib/admin/format";
import { Badge, Card, Empty, LoadError, Notice, PageHeader } from "../_components/ui";
import { ActionForm, ModalForm, SubmitButton } from "../_components/forms";
import { grantRole, revokeRole } from "../actions";

export const metadata = { title: "Admin Users" };
const roleHelp: Record<AdminRole, string> = {
  owner: "Everything, including pricing, limits, high-impact flags and managing admins.",
  admin: "Operate the business: users, credits, plans (not prices), flags, content and support.",
  support: "Support inbox, reports, feedback and support marks. Read-only elsewhere.",
  analyst: "Read-only dashboards and CSV exports.",
};

export default async function AdminsPage() {
  const admin = await getAdmin();
  const res = await adminRpc<any[]>("admin_admins");
  const owner = can(admin.role, "owner");
  return (
    <>
      <PageHeader title="Admin Users" description="Who can open this console and what they can do."
        actions={<ModalForm trigger={<><UserPlus aria-hidden /> Grant access</>} triggerClassName="ad-btn ad-btn-primary" title="Grant admin access"
          description="The person must already have a Zest Snap account." action={grantRole} submitLabel="Grant access" disabled={!owner}>
          <label className="ad-field">E-mail<input className="ad-input" type="email" name="email" required maxLength={320} /></label>
          <label className="ad-field">Role
            <select className="ad-select" name="role" defaultValue="support">{(Object.keys(roleLabels) as AdminRole[]).map((r) => <option key={r} value={r}>{roleLabels[r]} — {roleHelp[r]}</option>)}</select>
          </label>
        </ModalForm>} />
      {!owner && <Notice>Only Owners can grant, change or remove admin access.</Notice>}
      <div className="ad-grid ad-grid-21">
        <Card flush>
          {res.error ? <LoadError error={res.error} retryHref="/admin/admins" /> : !res.data.length ? <Empty title="No admins" icon={<ShieldCheck aria-hidden />} /> : (
            <div className="ad-table-wrap"><table className="ad-table">
              <thead><tr><th>Admin</th><th>Role</th><th>Granted</th><th>Last active</th><th /></tr></thead>
              <tbody>{res.data.map((a: any) => (
                <tr key={a.id}>
                  <td><b>{a.name || a.email}</b><span className="ad-sub">{a.email}</span></td>
                  <td><Badge tone={a.role === "owner" ? "navy" : "info"}>{roleLabels[a.role as AdminRole] || a.role}</Badge></td>
                  <td className="nowrap">{a.granted_at ? fmtDate(a.granted_at) : "Before roles"}{a.granted_by && <span className="ad-sub">by {a.granted_by}</span>}</td>
                  <td className="nowrap">{fmtRelative(a.last_active)}</td>
                  <td>
                    {owner && a.id !== admin.userId && (
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        <ModalForm trigger="Change role" triggerClassName="ad-btn ad-btn-sm" title={`Change role for ${a.email}`} action={grantRole} submitLabel="Save role">
                          <input type="hidden" name="email" value={a.email} />
                          <label className="ad-field">Role<select className="ad-select" name="role" defaultValue={a.role}>{(Object.keys(roleLabels) as AdminRole[]).map((r) => <option key={r} value={r}>{roleLabels[r]}</option>)}</select></label>
                        </ModalForm>
                        <ActionForm action={revokeRole} confirm={{ title: `Remove admin access for ${a.email}?`, body: "They keep their Zest Snap account but can no longer open Admin.", confirmLabel: "Remove access", danger: true }}>
                          <input type="hidden" name="user" value={a.id} />
                          <SubmitButton className="ad-btn ad-btn-sm ad-btn-ghost" pendingLabel="Removing…">Remove</SubmitButton>
                        </ActionForm>
                      </div>
                    )}
                    {a.id === admin.userId && <span className="ad-sub" style={{ textAlign: "right" }}>You</span>}
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
        <Card title="Roles">
          <dl className="ad-kv" style={{ gridTemplateColumns: "auto 1fr" }}>
            {(Object.keys(roleLabels) as AdminRole[]).map((r) => <Fragment key={r}><dt>{roleLabels[r]}</dt><dd style={{ fontWeight: 500 }}>{roleHelp[r]}</dd></Fragment>)}
          </dl>
          <p className="ad-sub" style={{ marginTop: 12 }}>Every permission is enforced again in the database. Zest Snap always keeps at least one Owner.</p>
        </Card>
      </div>
    </>
  );
}
