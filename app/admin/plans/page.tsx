import { ExternalLink } from "lucide-react";
import { adminRpc, getAdmin } from "@/lib/admin/server";
import { can } from "@/lib/admin/permissions";
import { fmtDateTime, fmtNumber } from "@/lib/admin/format";
import { formatPlanPrice } from "@/lib/plan-catalog";
import { Badge, Card, DevDetails, LoadError, Notice, PageHeader } from "../_components/ui";
import { ActionForm, SubmitButton } from "../_components/forms";
import { updatePlan } from "../actions";

export const metadata = { title: "Plans & Pricing" };

export default async function PlansPage() {
  const admin = await getAdmin();
  const res = await adminRpc<any>("admin_config");
  const owner = can(admin.role, "owner");
  const operate = can(admin.role, "operate");
  return (
    <>
      <PageHeader title="Plans & Pricing"
        description="The single source of truth for plan names, prices and allowances. The public pricing page, in-app usage limits and admin all read these values."
        actions={<a className="ad-btn" href="https://zestsnap.app/#pricing" target="_blank" rel="noreferrer"><ExternalLink aria-hidden /> View pricing page</a>} />
      <Notice title="What is enforced today">
        Monthly scans, PDF pages per scan and credits-per-bonus-scan are enforced server-side on every scan. Smart reminders, multi-event extraction,
        priority processing, calendar integrations and the rewards multiplier are shown on the pricing page but are not yet gated per plan in the app.
        {!owner && " Prices, currency and availability can only be changed by an Owner."}
      </Notice>
      {res.error ? <Card><LoadError error={res.error} retryHref="/admin/plans" /></Card> : (
        <div className="ad-plan-grid">
          {res.data.plans.map((p: any) => (
            <Card key={p.id}>
              <ActionForm action={updatePlan} className="ad-plan" confirm={{
                title: `Save ${p.name || p.id}?`,
                body: `Changes apply immediately to the pricing page and to usage limits for ${fmtNumber(p.users)} ${Number(p.users) === 1 ? "person" : "people"} on this plan.`,
                confirmLabel: "Save plan",
              }}>
                <input type="hidden" name="id" value={p.id} />
                <div className="ad-plan-head">
                  <div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                      <Badge tone={p.active ? "good" : "neutral"}>{p.active ? "Active" : "Inactive"}</Badge>
                      <Badge tone={p.is_public ? "info" : "neutral"}>{p.is_public ? "Public" : "Hidden"}</Badge>
                      {p.recommended && <Badge tone="navy">Recommended</Badge>}
                    </div>
                    <h2 style={{ fontSize: 18 }}>{p.name || p.id}</h2>
                    <span className="ad-sub">ID <span className="ad-mono">{p.id}</span> · {fmtNumber(p.users)} {Number(p.users) === 1 ? "account" : "accounts"}</span>
                  </div>
                  <div className="ad-plan-price">{formatPlanPrice(Number(p.monthly_price) || 0, p.currency || "USD")}<small> /mo</small></div>
                </div>
                <fieldset className="ad-fieldset" disabled={!operate}>
                  <legend>Listing</legend>
                  <div className="ad-form-grid">
                    <label className="ad-field">Public name<input className="ad-input" name="name" defaultValue={p.name || ""} required maxLength={40} /></label>
                    <label className="ad-field">Display order<input className="ad-input" name="display_order" type="number" min={0} max={100} defaultValue={p.display_order ?? 0} /></label>
                    <label className="ad-field full">Description<input className="ad-input" name="description" defaultValue={p.description || ""} maxLength={300} /></label>
                    <label className="ad-check full"><input type="checkbox" name="recommended" defaultChecked={!!p.recommended} /> Recommended plan</label>
                  </div>
                </fieldset>
                <fieldset className="ad-fieldset" disabled={!owner}>
                  <legend>Pricing & availability {owner ? "" : "· Owner only"}</legend>
                  <div className="ad-form-grid">
                    <label className="ad-field">Monthly price<input className="ad-input" name="monthly_price" type="number" step="0.01" min={0} max={10000} defaultValue={p.monthly_price ?? 0} /></label>
                    <label className="ad-field">Annual price <small>Optional</small><input className="ad-input" name="annual_price" type="number" step="0.01" min={0} max={100000} defaultValue={p.annual_price ?? ""} /></label>
                    <label className="ad-field">Currency<input className="ad-input" name="currency" defaultValue={p.currency || "USD"} pattern="[A-Za-z]{3}" maxLength={3} /></label>
                    <span />
                    <label className="ad-check"><input type="checkbox" name="active" defaultChecked={!!p.active} /> Active (can be used)</label>
                    <label className="ad-check"><input type="checkbox" name="is_public" defaultChecked={!!p.is_public} /> Shown on pricing page</label>
                  </div>
                </fieldset>
                <fieldset className="ad-fieldset" disabled={!operate}>
                  <legend>Allowances (enforced)</legend>
                  <div className="ad-form-grid">
                    <label className="ad-field">Monthly scans<input className="ad-input" name="monthly_scans" type="number" min={0} max={100000} defaultValue={p.monthly_scans} required /></label>
                    <label className="ad-field">PDF pages per scan<input className="ad-input" name="pdf_pages" type="number" min={1} max={100} defaultValue={p.pdf_pages} required /></label>
                    <label className="ad-field full">Credits per bonus scan <small>0 disables converting credits into scans</small>
                      <input className="ad-input" name="credits_per_bonus_scan" type="number" min={0} max={10000} defaultValue={p.credits_per_bonus_scan} required /></label>
                  </div>
                </fieldset>
                <fieldset className="ad-fieldset" disabled={!operate}>
                  <legend>Entitlements (pricing page)</legend>
                  <div className="ad-form-grid">
                    <label className="ad-check"><input type="checkbox" name="smart_reminders" defaultChecked={!!p.smart_reminders} /> Smart reminders</label>
                    <label className="ad-check"><input type="checkbox" name="bulk_extraction" defaultChecked={!!p.bulk_extraction} /> Multi-event extraction</label>
                    <label className="ad-check"><input type="checkbox" name="priority_processing" defaultChecked={!!p.priority_processing} /> Priority processing</label>
                    <label className="ad-check"><input type="checkbox" name="calendar_integrations" defaultChecked={p.calendar_integrations !== false} /> Calendar integrations</label>
                    <label className="ad-field">Rewards multiplier<input className="ad-input" name="rewards_multiplier" type="number" step="0.05" min={0} max={10} defaultValue={p.rewards_multiplier ?? 1} /></label>
                  </div>
                </fieldset>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span className="ad-sub">Updated {fmtDateTime(p.updated_at)}</span>
                  <SubmitButton disabled={!operate}>Save {p.name || p.id}</SubmitButton>
                </div>
              </ActionForm>
              <DevDetails data={p} />
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
