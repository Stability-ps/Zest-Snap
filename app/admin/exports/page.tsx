import { Download } from "lucide-react";
import { getAdmin } from "@/lib/admin/server";
import { can } from "@/lib/admin/permissions";
import { exportDefs } from "@/lib/admin/exports";
import { rangeQuery } from "@/lib/admin/range";
import { Card, Forbidden, Notice, PageHeader } from "../_components/ui";
import { readParams, rangeFrom, type SearchParams } from "../_components/page-utils";

export const metadata = { title: "Exports" };

export default async function ExportsPage({ searchParams }: { searchParams: SearchParams }) {
  const admin = await getAdmin();
  const params = await readParams(searchParams);
  const range = rangeFrom(params);
  const q = rangeQuery(range);
  const head = <PageHeader title="Exports" description={`CSV downloads generated on the server · ${range.label}. Change the range in the top bar.`} />;
  if (!can(admin.role, "export")) return <>{head}<Card><Forbidden /></Card></>;
  const groups = [...new Set(exportDefs.map((d) => d.group))];
  return (
    <>
      {head}
      <Notice>Every export is recorded in the audit log. Files contain personal data — store and share them carefully. Spreadsheet formulas in cells are neutralised.</Notice>
      <div className="ad-grid ad-grid-2">
        {groups.map((g) => (
          <Card key={g} title={g} flush>
            <div className="ad-list">
              {exportDefs.filter((d) => d.group === g).map((d) => (
                <div key={d.key} className="ad-list-row" style={params.dataset === d.key ? { background: "var(--ad-teal-soft)" } : undefined}>
                  <span className="grow"><b>{d.label}</b><span className="ad-sub">{d.description}</span></span>
                  <a className="ad-btn ad-btn-sm" href={`/admin/exports/${d.key}${q ? "?" + q : ""}`} download><Download aria-hidden /> CSV</a>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
