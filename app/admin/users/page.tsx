import Link from "next/link";
import { Download, Search, Users } from "lucide-react";
import { adminRpc } from "@/lib/admin/server";
import { fmtDate, fmtNumber, fmtRelative } from "@/lib/admin/format";
import { Badge, Card, Chips, Empty, LoadError, PageHeader, Pager, PlanBadge, StatusBadge } from "../_components/ui";
import { linkWith, pageOf, readParams, type SearchParams } from "../_components/page-utils";

export const metadata = { title: "Users" };
const PAGE = 25;
const filters = [
  ["", "All"], ["free", "Free"], ["plus", "Plus"], ["business", "Business"], ["active", "Active (30d)"], ["inactive", "Inactive"],
  ["today", "Signed up today"], ["week", "This week"], ["heavy", "Heavy users"], ["no_activity", "No activity"], ["calendar", "Calendar connected"],
  ["referral", "Referred"], ["flagged", "Support-marked"], ["disabled", "Disabled"], ["admins", "Admins"],
] as const;
const sorts = [["created_desc", "Newest"], ["created_asc", "Oldest"], ["active_desc", "Recently active"], ["scans_desc", "Most scans this month"], ["name", "Name"]] as const;

export default async function UsersPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await readParams(searchParams);
  const page = pageOf(params);
  const filter = filters.some(([k]) => k === params.filter) ? params.filter : "";
  const sort = sorts.some(([k]) => k === params.sort) ? params.sort : "created_desc";
  const res = await adminRpc<{ total: number; rows: any[] }>("admin_users", {
    p_search: params.q || null, p_filter: filter || null, p_sort: sort, p_limit: PAGE, p_offset: page * PAGE,
  });
  return (
    <>
      <PageHeader title="Users" description="Everyone with a Zest Snap account. Click a person for their full profile, usage and support history."
        actions={<Link className="ad-btn" href="/admin/exports?dataset=users"><Download aria-hidden /> Export users</Link>} />
      <Card flush>
        <form className="ad-toolbar" action="/admin/users">
          <input className="ad-input" type="search" name="q" defaultValue={params.q || ""} placeholder="Name, e-mail or user ID" aria-label="Search users" />
          {filter && <input type="hidden" name="filter" value={filter} />}
          <select className="ad-select" name="sort" defaultValue={sort} aria-label="Sort">
            {sorts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <button className="ad-btn"><Search aria-hidden /> Search</button>
          {(params.q || filter) && <Link className="ad-btn ad-btn-ghost" href="/admin/users">Clear</Link>}
        </form>
        <div style={{ padding: "12px 18px 0" }}>
          <Chips current={filter} items={filters.map(([k, l]) => ({ key: k, label: l, href: linkWith("/admin/users", params, { filter: k || null }) }))} />
        </div>
        <div style={{ marginTop: 12 }}>
          {res.error ? <LoadError error={res.error} retryHref="/admin/users" /> : !res.data.rows.length ? (
            <Empty title={params.q || filter ? "No matching users" : "No users yet"} icon={<Users aria-hidden />}>
              {params.q || filter ? "Try a different search or filter." : "People appear here as soon as they create an account."}
            </Empty>
          ) : (
            <>
              <div className="ad-table-wrap">
                <table className="ad-table">
                  <thead><tr>
                    <th>User</th><th>Joined</th><th>Last active</th><th>Plan</th><th className="ad-hide-sm">Subscription</th>
                    <th className="num">Scans (month)</th><th className="num">Planner</th><th className="num">Credits</th>
                    <th className="ad-hide-md">Calendar</th><th className="ad-hide-md">Region</th><th>Status</th>
                  </tr></thead>
                  <tbody>
                    {res.data.rows.map((u) => (
                      <tr key={u.id}>
                        <td>
                          <Link className="ad-row-link" href={`/admin/users/${u.id}`}>{u.display_name || u.email || "Unnamed"}</Link>
                          <span className="ad-sub">{u.email}</span>
                        </td>
                        <td className="nowrap">{fmtDate(u.created_at)}</td>
                        <td className="nowrap">{fmtRelative(u.last_active)}</td>
                        <td><PlanBadge plan={u.plan} /></td>
                        <td className="ad-hide-sm">{u.sub_status ? <StatusBadge status={u.sub_status} /> : <span className="ad-sub">None</span>}</td>
                        <td className="num">{fmtNumber(u.scans_month)}</td>
                        <td className="num">{fmtNumber(u.planner_count)}</td>
                        <td className="num">{fmtNumber(u.credits)}</td>
                        <td className="ad-hide-md">{u.calendar_connected ? <Badge tone="good">Connected</Badge> : <span className="ad-sub">—</span>}</td>
                        <td className="ad-hide-md nowrap">{[u.country_code, u.locale].filter(Boolean).join(" · ") || "—"}</td>
                        <td>
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                            <StatusBadge status={u.account_status} />
                            {u.is_admin && <Badge tone="navy">Admin</Badge>}
                            {u.support_flag && <Badge tone="warn">Support</Badge>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager total={Number(res.data.total)} page={page} pageSize={PAGE} href={(p) => linkWith("/admin/users", params, { page: p || null })} />
            </>
          )}
        </div>
      </Card>
    </>
  );
}
