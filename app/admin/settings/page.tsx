import { adminRpc, getAdmin } from "@/lib/admin/server";
import { can } from "@/lib/admin/permissions";
import { fmtDateTime, humanize } from "@/lib/admin/format";
import { productConfig } from "@/lib/product-config";
import { Card, LoadError, Notice, PageHeader } from "../_components/ui";
import { ActionForm, SubmitButton } from "../_components/forms";
import { updateLimit } from "../actions";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const admin = await getAdmin();
  const res = await adminRpc<any>("admin_config");
  const owner = can(admin.role, "owner");
  return (
    <>
      <PageHeader title="Settings" description="Abuse limits and product constants. Limits apply immediately to every scan and reward." />
      {!owner && <Notice>Only Owners can change limits.</Notice>}
      <div className="ad-grid ad-grid-21">
        <Card title="Usage & abuse limits" flush>
          {res.error ? <LoadError error={res.error} retryHref="/admin/settings" /> : (
            <div>
              {res.data.limits.map((l: any) => (
                <div className="ad-flag" key={l.key}>
                  <div className="grow"><b>{humanize(l.key)}</b><span className="ad-sub">{l.description}</span><span className="ad-sub"><span className="ad-mono">{l.key}</span> · updated {fmtDateTime(l.updated_at)}</span></div>
                  <ActionForm action={updateLimit} className="ad-inline-form" confirm={{ title: `Change ${humanize(l.key)}?`, body: "This applies to every user immediately.", confirmLabel: "Save" }}>
                    <input type="hidden" name="key" value={l.key} />
                    <input className="ad-input" name="value" type="number" min={0} max={1000000} defaultValue={l.value} style={{ width: 100 }} aria-label={humanize(l.key)} disabled={!owner} />
                    <SubmitButton className="ad-btn ad-btn-sm" disabled={!owner}>Save</SubmitButton>
                  </ActionForm>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="Product">
          <dl className="ad-kv">
            <dt>Primary domain</dt><dd>{productConfig.primaryDomain}</dd>
            <dt>App</dt><dd>app.{productConfig.primaryDomain}</dd>
            <dt>Support e-mail</dt><dd>{productConfig.supportEmail}</dd>
            <dt>Privacy e-mail</dt><dd>{productConfig.privacyEmail}</dd>
            <dt>Your role</dt><dd style={{ textTransform: "capitalize" }}>{admin.role}</dd>
          </dl>
          <p className="ad-sub" style={{ marginTop: 12 }}>Plans and prices live in Plans & Pricing; feature switches in Feature Flags.</p>
        </Card>
      </div>
    </>
  );
}
