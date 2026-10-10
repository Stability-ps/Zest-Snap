import { adminRpc, getAdmin, iso } from "@/lib/admin/server";
import { can } from "@/lib/admin/permissions";
import { fmtNumber, fmtPercent, humanize, ratio } from "@/lib/admin/format";
import { Badge, Card, LoadError, Notice, PageHeader, Stats } from "../_components/ui";
import { ActionForm, SubmitButton } from "../_components/forms";
import { readParams, rangeFrom, type SearchParams } from "../_components/page-utils";
import { saveMarketingCampaign } from "../actions";
import { ONESIGNAL_APP_ID } from "@/lib/marketing/onesignal";

export const metadata = { title: "Campaigns" };

const describe: Record<string, string> = {
  reward_earned: "When someone earns credits (sent within 2 days of earning, once per reward).",
  free_scans_exhausted: "Free plan, this month’s AI scans used up (once per month).",
  inactive_users: "No activity for the configured number of days, but active within 45 days (once per quiet stretch).",
};

/** OneSignal setup the scheduler depends on. Reports presence only — never values. */
async function setupStatus() {
  let webPush: "configured" | "not_configured" | "unknown" = "unknown";
  try {
    const res = await fetch(`https://api.onesignal.com/sync/${ONESIGNAL_APP_ID}/web`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    const body = (await res.json().catch(() => ({}))) as { success?: boolean; code?: number };
    webPush = body?.success === false && body?.code === 2 ? "not_configured" : res.ok ? "configured" : "unknown";
  } catch {}
  return { restKey: Boolean(process.env.ONESIGNAL_REST_API_KEY), cronSecret: Boolean(process.env.CRON_SECRET), webPush };
}

export default async function CampaignsPage({ searchParams }: { searchParams: SearchParams }) {
  const admin = await getAdmin();
  const operate = can(admin.role, "operate");
  const range = rangeFrom(await readParams(searchParams));
  const [res, setup] = await Promise.all([adminRpc<any>("admin_marketing", { p_from: iso(range.from), p_to: iso(range.to) }), setupStatus()]);
  const head = <PageHeader title="Campaigns" description={`Marketing notifications through OneSignal · opt-in only · ${range.label}`} />;
  if (res.error) return <>{head}<Card><LoadError error={res.error} retryHref="/admin/campaigns" /></Card></>;
  const d = res.data;
  const ready = setup.restKey && setup.cronSecret;
  return (
    <>
      {head}
      <Card title="Delivery setup">
        {!ready && <Notice tone="warn">Campaigns can be prepared, but nothing is sent until the OneSignal REST API key and CRON_SECRET are set in Vercel.</Notice>}
        <Stats items={[
          { label: "OneSignal REST API key", value: setup.restKey ? <Badge tone="good">Set</Badge> : <Badge tone="warn">Missing</Badge> },
          { label: "Scheduler secret", value: setup.cronSecret ? <Badge tone="good">Set</Badge> : <Badge tone="warn">Missing</Badge> },
          { label: "Web push in OneSignal", value: setup.webPush === "configured" ? <Badge tone="good">Configured</Badge> : setup.webPush === "not_configured" ? <Badge tone="warn">Not configured</Badge> : "Unknown" },
          { label: "Opted in", value: fmtNumber(Number(d.consent?.opted_in || 0)) },
          { label: "Opted out", value: fmtNumber(Number(d.consent?.opted_out || 0)) },
          { label: "Frequency limit", value: `${d.limits?.marketing_max_per_week ?? 2}/week · ${d.limits?.marketing_min_hours_between ?? 72}h apart · quiet ${d.limits?.marketing_quiet_start_hour ?? 21}:00–${d.limits?.marketing_quiet_end_hour ?? 9}:00 local` },
        ]} />
        <p style={{ fontSize: 12, marginTop: 10, color: "var(--zadm-muted, #64748b)" }}>
          Opted in by platform: {Object.entries(d.consent?.by_platform || {}).map(([k, v]) => `${humanize(k)} ${v}`).join(" · ") || "none yet"}. Limits are editable under Settings › App limits.
        </p>
      </Card>
      {(d.campaigns || []).map((c: any) => (
        <Card key={c.key} title={humanize(c.key)} description={describe[c.key]} actions={c.enabled ? <Badge tone="good">On</Badge> : <Badge>Off</Badge>}>
          <Stats items={[
            { label: "Sent", value: fmtNumber(Number(c.sent)) },
            { label: "Not delivered (no device)", value: fmtNumber(Number(c.skipped ?? 0)) },
            { label: "Failed", value: fmtNumber(Number(c.failed)) },
            { label: "Opened", value: `${fmtNumber(Number(c.opened))} · ${fmtPercent(ratio(c.opened, c.sent))}` },
            { label: "Came back within 3 days", value: `${fmtNumber(Number(c.returned))} · ${fmtPercent(ratio(c.returned, c.sent))}` },
            { label: "Queued", value: fmtNumber(Number(c.queued)) },
          ]} />
          {operate && (
            <ActionForm action={saveMarketingCampaign} className="zadm-form-grid" >
              <input type="hidden" name="key" value={c.key} />
              <label className="zadm-field">Title <small>max 65</small><input className="zadm-input" name="title" maxLength={65} required defaultValue={c.title} /></label>
              <label className="zadm-field">Opens <small>in-app path, e.g. /app?view=rewards</small><input className="zadm-input" name="path" maxLength={200} required pattern="/app(\?[A-Za-z0-9=&_\-]*)?" defaultValue={c.path} /></label>
              <label className="zadm-field full">Message <small>max 180</small><textarea className="zadm-textarea" name="body" maxLength={180} required defaultValue={c.body} rows={2} /></label>
              <label className="zadm-field"><span><input type="checkbox" name="enabled" defaultChecked={c.enabled} /> Send this campaign</span></label>
              <SubmitButton>Save</SubmitButton>
            </ActionForm>
          )}
        </Card>
      ))}
    </>
  );
}
