import { FileText, Plus, Trash2 } from "lucide-react";
import { adminRpc, getAdmin } from "@/lib/admin/server";
import { can } from "@/lib/admin/permissions";
import { fmtDateTime, fmtNumber } from "@/lib/admin/format";
import { Card, Empty, LoadError, Notice, PageHeader } from "../_components/ui";
import { ActionForm, ModalForm, SubmitButton } from "../_components/forms";
import { deleteContent, saveContent } from "../actions";

export const metadata = { title: "Content" };

export default async function ContentPage() {
  const admin = await getAdmin();
  const res = await adminRpc<any>("admin_config");
  const operate = can(admin.role, "operate");
  const items: any[] = res.data?.content || [];
  return (
    <>
      <PageHeader title="Content" description="Drafts for copy, e-mails and notices. Drafts are stored only — saving never publishes or sends anything."
        actions={<ModalForm trigger={<><Plus aria-hidden /> New draft</>} triggerClassName="ad-btn ad-btn-primary" title="New content draft" action={saveContent} submitLabel="Save draft" disabled={!operate}>
          <label className="ad-field">Key <small>Lowercase letters, numbers, - and _ (e.g. welcome_email)</small>
            <input className="ad-input" name="key" required pattern="[a-z0-9_\-]{1,60}" maxLength={60} />
          </label>
          <label className="ad-field">Content<textarea className="ad-textarea" name="body" required maxLength={10000} rows={10} /></label>
        </ModalForm>} />
      <Notice>Legal pages and in-app copy are not changed by these drafts. Use Notifications to publish an in-app announcement.</Notice>
      {res.error ? <Card><LoadError error={res.error} retryHref="/admin/content" /></Card> : !items.length ? (
        <Card><Empty title="No drafts yet" icon={<FileText aria-hidden />}>Create a draft to keep copy and notices in one place.</Empty></Card>
      ) : (
        <div className="ad-grid ad-grid-2">
          {items.map((c) => (
            <Card key={c.key} title={<span className="ad-mono" style={{ fontSize: 14 }}>{c.key}</span>} description={`Updated ${fmtDateTime(c.updated_at)} · ${fmtNumber(String(c.body).length)} characters`}
              actions={<ActionForm action={deleteContent} confirm={{ title: `Delete “${c.key}”?`, body: "This draft will be removed permanently.", confirmLabel: "Delete", danger: true }}>
                <input type="hidden" name="key" value={c.key} />
                <SubmitButton className="ad-btn ad-btn-sm ad-btn-ghost" disabled={!operate} pendingLabel="Deleting…"><Trash2 aria-hidden /> Delete</SubmitButton>
              </ActionForm>}>
              <ActionForm action={saveContent} className="ad-grid">
                <input type="hidden" name="key" value={c.key} />
                <textarea className="ad-textarea" name="body" defaultValue={c.body} required maxLength={10000} rows={8} aria-label={`Content for ${c.key}`} disabled={!operate} />
                <div><SubmitButton className="ad-btn" disabled={!operate}>Save draft</SubmitButton></div>
              </ActionForm>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
