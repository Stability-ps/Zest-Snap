import { Megaphone, Plus, Send } from "lucide-react";
import { adminRpc, getAdmin } from "@/lib/admin/server";
import { can } from "@/lib/admin/permissions";
import { fmtDateTime, fmtNumber, humanize } from "@/lib/admin/format";
import { Badge, Card, Empty, LoadError, Notice, PageHeader, StatusBadge } from "../_components/ui";
import { ActionForm, ModalForm, SubmitButton } from "../_components/forms";
import { saveAnnouncement, setAnnouncementStatus } from "../actions";

export const metadata = { title: "Notifications" };
const local = (v: string | null) => (v ? new Date(v).toISOString().slice(0, 16) : "");

function AnnouncementFields({ a }: { a?: any }) {
  return (
    <>
      {a && <input type="hidden" name="id" value={a.id} />}
      <label className="ad-field">Title<input className="ad-input" name="title" required maxLength={120} defaultValue={a?.title || ""} /></label>
      <label className="ad-field">Message<textarea className="ad-textarea" name="body" required maxLength={2000} defaultValue={a?.body || ""} /></label>
      <div className="ad-form-grid">
        <label className="ad-field">Audience
          <select className="ad-select" name="audience" defaultValue={a?.audience || "all"}>
            <option value="all">All users</option><option value="free">Free</option><option value="plus">Plus</option><option value="business">Business</option><option value="selected">Selected users</option>
          </select>
        </label>
        <span />
        <label className="ad-field">Starts <small>UTC · optional</small><input className="ad-input" type="datetime-local" name="starts_at" defaultValue={local(a?.starts_at)} /></label>
        <label className="ad-field">Ends <small>UTC · optional</small><input className="ad-input" type="datetime-local" name="ends_at" defaultValue={local(a?.ends_at)} /></label>
        <label className="ad-field full">Selected user IDs <small>Only for “Selected users” · separated by commas or new lines</small>
          <textarea className="ad-textarea" name="user_ids" rows={3} defaultValue={(a?.user_ids || []).join("\n")} style={{ minHeight: 60 }} />
        </label>
      </div>
    </>
  );
}

export default async function NotificationsPage() {
  const admin = await getAdmin();
  const res = await adminRpc<any>("admin_config");
  const operate = can(admin.role, "operate");
  const items: any[] = res.data?.announcements || [];
  return (
    <>
      <PageHeader title="Notifications" description="In-app announcements. Every message is a draft until you preview it and press Publish."
        actions={<ModalForm trigger={<><Plus aria-hidden /> New announcement</>} triggerClassName="ad-btn ad-btn-primary" title="New announcement" description="Saved as a draft. Nothing is shown to users until you publish."
          action={saveAnnouncement} submitLabel="Save draft" disabled={!operate}><AnnouncementFields /></ModalForm>} />
      <Notice tone="warn" title="Where announcements appear">
        Published announcements are available to the audience through the database (with row-level security), but the Zest Snap app does not display them yet —
        adding a slot to the Home screen is a separate product decision. Publishing therefore changes nothing users see today.
      </Notice>
      <Card title="Push campaigns">
        <Notice>
          Push broadcasts are not available. Zest Snap&apos;s push system delivers per-reminder notifications through a scheduled job and has no safe, rate-limited
          broadcast path. Nothing will be sent from here.
        </Notice>
      </Card>
      {res.error ? <Card><LoadError error={res.error} retryHref="/admin/notifications" /></Card> : !items.length ? (
        <Card><Empty title="No announcements yet" icon={<Megaphone aria-hidden />}>Create a draft, preview it here, then publish it.</Empty></Card>
      ) : (
        <div className="ad-grid ad-grid-2">
          {items.map((a) => (
            <Card key={a.id} title={a.title} description={`${a.audience === "selected" ? `${fmtNumber(a.user_ids?.length || 0)} selected users` : `Audience: ${humanize(a.audience)}`} · updated ${fmtDateTime(a.updated_at)}`}
              actions={<StatusBadge status={a.status} />}>
              <div style={{ border: "1px solid var(--ad-line)", borderRadius: 14, padding: 14, background: "#fbfcfe" }} aria-label="Preview">
                <Badge tone="info">Preview</Badge>
                <h3 style={{ fontSize: 15, margin: "8px 0 4px" }}>{a.title}</h3>
                <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{a.body}</p>
              </div>
              <p className="ad-sub">{a.starts_at ? `From ${fmtDateTime(a.starts_at)}` : "Starts when published"}{a.ends_at ? ` · until ${fmtDateTime(a.ends_at)}` : " · no end date"}{a.published_at ? ` · published ${fmtDateTime(a.published_at)}` : ""}</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {a.status !== "archived" && (
                  <ModalForm trigger="Edit" triggerClassName="ad-btn ad-btn-sm" title="Edit announcement" action={saveAnnouncement} submitLabel="Save" disabled={!operate}><AnnouncementFields a={a} /></ModalForm>
                )}
                {a.status === "draft" && (
                  <ActionForm action={setAnnouncementStatus} confirm={{ title: "Publish this announcement?", body: `It becomes available to ${a.audience === "all" ? "all users" : a.audience === "selected" ? "the selected users" : `${humanize(a.audience)} users`}${a.starts_at ? ` from ${fmtDateTime(a.starts_at)}` : " now"}.`, confirmLabel: "Publish" }}>
                    <input type="hidden" name="id" value={a.id} /><input type="hidden" name="status" value="published" />
                    <SubmitButton className="ad-btn ad-btn-sm ad-btn-teal" disabled={!operate}><Send aria-hidden /> Publish</SubmitButton>
                  </ActionForm>
                )}
                {a.status === "published" && (
                  <ActionForm action={setAnnouncementStatus}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="status" value="draft" />
                    <SubmitButton className="ad-btn ad-btn-sm" disabled={!operate}>Unpublish</SubmitButton></ActionForm>
                )}
                {a.status !== "archived" && (
                  <ActionForm action={setAnnouncementStatus} confirm={{ title: "Archive this announcement?", body: "Archived announcements can't be edited or republished.", confirmLabel: "Archive", danger: true }}>
                    <input type="hidden" name="id" value={a.id} /><input type="hidden" name="status" value="archived" />
                    <SubmitButton className="ad-btn ad-btn-sm ad-btn-ghost" disabled={!operate}>Archive</SubmitButton>
                  </ActionForm>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
