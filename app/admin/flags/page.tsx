import { adminRpc, getAdmin } from "@/lib/admin/server";
import { can } from "@/lib/admin/permissions";
import { fmtDateTime } from "@/lib/admin/format";
import { flagGroups, metaFor } from "@/lib/admin/flags";
import { Badge, Card, LoadError, Notice, PageHeader } from "../_components/ui";
import { SwitchForm } from "../_components/forms";
import { setFlag } from "../actions";

export const metadata = { title: "Feature Flags" };

export default async function FlagsPage() {
  const admin = await getAdmin();
  const res = await adminRpc<any>("admin_config");
  const flags: any[] = res.data?.flags || [];
  return (
    <>
      <PageHeader title="Feature Flags" description="Switch product capabilities on or off for everyone. Changes take effect immediately and are recorded in the audit log." />
      <Notice tone="warn" title="Live switches">High-impact flags ask for confirmation. AI scanning and cloud persistence can only be changed by an Owner.</Notice>
      {res.error ? <Card><LoadError error={res.error} retryHref="/admin/flags" /></Card> : (
        <div className="ad-grid ad-grid-2">
          {flagGroups.map((group) => {
            const items = flags.filter((f) => metaFor(f.key, f.description).group === group);
            if (!items.length) return null;
            return (
              <Card key={group} title={group} flush>
                <div>
                  {items.map((f) => {
                    const m = metaFor(f.key, f.description);
                    const allowed = can(admin.role, m.ownerOnly ? "owner" : "operate");
                    return (
                      <div className="ad-flag" key={f.key}>
                        <div className="grow">
                          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                            <b>{m.label}</b>
                            <Badge tone={f.enabled ? "good" : "neutral"}>{f.enabled ? "On" : "Off"}</Badge>
                            {m.highImpact && <Badge tone="warn">High impact</Badge>}
                            {m.ownerOnly && <Badge>Owner only</Badge>}
                          </div>
                          <span className="ad-sub">{m.description || f.description}</span>
                          <span className="ad-sub"><span className="ad-mono">{f.key}</span> · updated {fmtDateTime(f.updated_at)}{f.public_visible ? " · visible to signed-out visitors" : ""}</span>
                        </div>
                        <SwitchForm action={setFlag} name="key" value={f.key} checked={!!f.enabled} label={`${m.label}: ${f.enabled ? "on" : "off"}`}
                          hidden={{ enabled: String(!f.enabled) }} disabled={!allowed}
                          confirm={m.highImpact ? {
                            title: `${f.enabled ? "Turn off" : "Turn on"} ${m.label}?`,
                            body: `${m.description} This affects every user immediately.`,
                            confirmLabel: f.enabled ? "Turn off" : "Turn on",
                            danger: !!f.enabled,
                          } : undefined} />
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
