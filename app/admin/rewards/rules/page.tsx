import { adminRpc, getAdmin, iso } from "@/lib/admin/server";
import { can } from "@/lib/admin/permissions";
import { fmtDateTime } from "@/lib/admin/format";
import { parseRange } from "@/lib/admin/range";
import { Badge, Card, Empty, LoadError, Notice, PageHeader } from "../../_components/ui";
import { ActionForm, SubmitButton } from "../../_components/forms";
import { updateRewardRule } from "../../actions";

export const metadata = { title: "Reward Rules" };
const repeatable: Record<string, string> = { referral_qualified: "Per qualified referral (monthly cap in Settings)", product_feedback: "Once per account" };

export default async function RewardRulesPage() {
  const admin = await getAdmin();
  const range = parseRange({ range: "30d" });
  const res = await adminRpc<any>("admin_rewards", { p_from: iso(range.from), p_to: iso(range.to) });
  const operate = can(admin.role, "operate");
  return (
    <>
      <PageHeader title="Reward Rules" crumbs={[{ href: "/admin/rewards", label: "Rewards" }, { label: "Rules" }]}
        description="How many Zest Credits each milestone earns. Changes apply to rewards earned from now on; past credits are never changed." />
      <Notice>Rewards are for taking an action — feedback earns the same credits whatever the rating. Milestones are once per account; this is enforced by the database.</Notice>
      <Card flush>
        {res.error ? <LoadError error={res.error} retryHref="/admin/rewards/rules" /> : !res.data.rules.length ? <Empty title="No reward rules" /> : (
          <div className="zadm-table-wrap">
            <table className="zadm-table">
              <thead><tr><th>Rule</th><th>Public label</th><th className="num">Credits</th><th>Active</th><th className="zadm-hide-md">Frequency</th><th className="zadm-hide-md">Updated</th><th /></tr></thead>
              <tbody>
                {res.data.rules.map((r: any) => (
                  <tr key={r.key}>
                    <td><span className="zadm-mono">{r.key}</span></td>
                    <td colSpan={3} style={{ padding: 0 }}>
                      <ActionForm action={updateRewardRule} inline className="zadm-inline-form">
                        <input type="hidden" name="key" value={r.key} />
                        <input className="zadm-input" name="label" defaultValue={r.label || ""} maxLength={60} aria-label="Public label" style={{ minWidth: 160 }} disabled={!operate} />
                        <input className="zadm-input" name="amount" type="number" min={0} max={1000} defaultValue={r.amount} aria-label="Credits" style={{ width: 90 }} disabled={!operate} />
                        <label className="zadm-check"><input type="checkbox" name="enabled" defaultChecked={!!r.enabled} disabled={!operate} /> Active</label>
                        <SubmitButton className="zadm-btn zadm-btn-sm" disabled={!operate}>Save</SubmitButton>
                      </ActionForm>
                    </td>
                    <td className="zadm-hide-md">{repeatable[r.key] || <Badge>Once per account</Badge>}</td>
                    <td className="zadm-hide-md nowrap">{fmtDateTime(r.updated_at)}</td>
                    <td />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
