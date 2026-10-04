import { test } from "node:test";
import assert from "node:assert/strict";
import { adminAccess, can } from "../lib/admin/permissions";
import { parseRange, rangeQuery } from "../lib/admin/range";
import { csvCell, csvFilename, csvRow } from "../lib/admin/csv";
import { pctChange, ratio } from "../lib/admin/format";
import { exportDefs } from "../lib/admin/exports";
import { catalogFromRows, fallbackCatalog } from "../lib/plan-catalog";
import { plans } from "../lib/product-config";
import { activeHref, adminNav } from "../app/admin/_components/nav";

test("/admin access: signed-out users sign in, non-admins are denied, only is_admin=true is allowed", () => {
  assert.equal(adminAccess(null, null), "sign_in");
  assert.equal(adminAccess({ id: "u" }, null), "denied");
  assert.equal(adminAccess({ id: "u" }, { is_admin: false }), "denied");
  assert.equal(adminAccess({ id: "u" }, { is_admin: null }), "denied");
  assert.equal(adminAccess({ id: "u" }, { is_admin: "true" as unknown as boolean }), "denied");
  assert.equal(adminAccess({ id: "u" }, { is_admin: true }), "allowed");
});

test("role ladder mirrors the database permissions", () => {
  assert.ok(can("owner", "owner") && can("owner", "operate") && can("owner", "export"));
  assert.ok(can("admin", "operate") && !can("admin", "owner"));
  assert.ok(can("support", "support") && !can("support", "operate") && !can("support", "export"));
  assert.ok(can("analyst", "export") && can("analyst", "view") && !can("analyst", "support"));
  assert.ok(!can(null, "view") && !can(undefined, "view"));
});

test("date ranges are UTC, end-exclusive, and filter correctly", () => {
  const now = new Date("2026-10-04T15:30:00Z");
  const today = parseRange({ range: "today" }, now);
  assert.equal(today.from.toISOString(), "2026-10-04T00:00:00.000Z");
  assert.equal(today.to.toISOString(), "2026-10-05T00:00:00.000Z");
  const week = parseRange({ range: "7d" }, now);
  assert.equal(week.from.toISOString(), "2026-09-28T00:00:00.000Z");
  const month = parseRange({ range: "month" }, now);
  assert.equal(month.from.toISOString(), "2026-10-01T00:00:00.000Z");
  const last = parseRange({ range: "last_month" }, now);
  assert.deepEqual([last.from.toISOString(), last.to.toISOString()], ["2026-09-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"]);
  const custom = parseRange({ range: "custom", from: "2026-02-01", to: "2026-02-28" }, now);
  assert.deepEqual([custom.from.toISOString(), custom.to.toISOString()], ["2026-02-01T00:00:00.000Z", "2026-03-01T00:00:00.000Z"]);
  assert.equal(rangeQuery(custom), "range=custom&from=2026-02-01&to=2026-02-28");
  // Invalid or reversed custom ranges fall back to 30 days instead of erroring.
  assert.equal(parseRange({ range: "custom", from: "2026-03-01", to: "2026-02-01" }, now).key, "30d");
  assert.equal(parseRange({ range: "custom", from: "2026-02-30", to: "2026-03-01" }, now).key, "30d");
  assert.equal(parseRange({ range: "nonsense" }, now).key, "30d");
  // Huge custom ranges are clamped to the database's 800-day limit.
  const huge = parseRange({ range: "custom", from: "2000-01-01", to: "2026-01-01" }, now);
  assert.ok((huge.to.getTime() - huge.from.getTime()) / 86400000 <= 800);
  assert.equal(parseRange({ range: "90d" }, now).bucket, "week");
  assert.equal(huge.bucket, "month");
});

test("CSV escapes quotes, commas, newlines and neutralises formulas", () => {
  assert.equal(csvCell('He said "hi", then left'), '"He said ""hi"", then left"');
  assert.equal(csvCell("line1\nline2"), '"line1\nline2"');
  assert.equal(csvCell("=HYPERLINK(\"http://evil\")"), `"'=HYPERLINK(""http://evil"")"`);
  assert.equal(csvCell("+SUM(A1)"), "'+SUM(A1)");
  assert.equal(csvCell("@cmd"), "'@cmd");
  assert.equal(csvCell(-5), "-5");
  assert.equal(csvCell("-12.5"), "-12.5");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell({ a: 1 }), '"{""a"":1}"');
  assert.equal(csvRow(["a", 1, null]), "a,1,\r\n");
  assert.equal(csvFilename("users", new Date("2026-09-01T00:00:00Z"), new Date("2026-10-01T00:00:00Z")), "zest-snap-users-2026-09-01-to-2026-09-30.csv");
});

test("percentage change and ratios never invent a base", () => {
  assert.equal(pctChange(10, 0), null);
  assert.equal(pctChange(15, 10), 0.5);
  assert.equal(ratio(1, 0), null);
  assert.equal(ratio(1, 4), 0.25);
});

test("every export has unique keys and columns", () => {
  const keys = exportDefs.map((d) => d.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const d of exportDefs) assert.equal(new Set(d.columns).size, d.columns.length, d.key);
  for (const k of ["users", "activity", "scans", "usage", "revenue", "subscriptions", "rewards", "referrals", "ratings", "tickets", "reports", "failed_payments", "refunds", "transactions", "revenue_summary"])
    assert.ok(keys.includes(k), k);
  for (const d of exportDefs) for (const c of d.columns) assert.doesNotMatch(c, /access_token|refresh_token|password|secret|_hash$|keys|endpoint/i, `${d.key}.${c}`);
});

test("plan catalog: database rows drive pricing; code defaults are only a fallback", () => {
  const fb = fallbackCatalog();
  assert.deepEqual(fb.map((p) => [p.id, p.monthlyPrice, p.monthlyScans]), [["free", plans.free.monthlyUsd, plans.free.monthlyScans], ["plus", plans.plus.monthlyUsd, plans.plus.monthlyScans], ["business", plans.business.monthlyUsd, plans.business.monthlyScans]]);
  const db = catalogFromRows([
    { id: "business", name: "Teams", monthly_price: "19.00", monthly_scans: 500, pdf_pages: 60, display_order: 2, currency: "EUR" },
    { id: "free", name: "Free", monthly_price: 0, monthly_scans: 12, pdf_pages: 3, display_order: 1 },
  ]);
  assert.deepEqual(db.map((p) => [p.id, p.name, p.monthlyPrice, p.currency, p.monthlyScans]), [["free", "Free", 0, "USD", 12], ["business", "Teams", 19, "EUR", 500]]);
});

test("admin navigation highlights the most specific section", () => {
  assert.equal(activeHref("/admin"), "/admin");
  assert.equal(activeHref("/admin/users/123"), "/admin/users");
  assert.equal(activeHref("/admin/rewards/rules"), "/admin/rewards/rules");
  assert.equal(activeHref("/admin/rewards"), "/admin/rewards");
  assert.equal(activeHref("/admin/revenue/transactions"), "/admin/revenue/transactions");
  const hrefs = adminNav.flatMap((g) => g.items.map((i) => i.href));
  assert.equal(new Set(hrefs).size, hrefs.length);
});

test("every /admin page, route and action is authorised on the server", async () => {
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
  const files = walk("app/admin");
  const pages = files.filter((f) => f.endsWith("page.tsx"));
  assert.ok(pages.length >= 30, `found ${pages.length} pages`);
  for (const f of pages) {
    const src = readFileSync(f, "utf8");
    assert.match(src, /\b(getAdmin|adminRpc)(<[^>]*>)?\(/, `${f} must check admin access server-side`);
    assert.doesNotMatch(src, /^"use client"/, `${f} must be a server component`);
  }
  for (const f of files.filter((f) => f.endsWith("route.ts"))) assert.match(readFileSync(f, "utf8"), /requireAdmin\("export"\)/, f);
  const layout = readFileSync("app/admin/layout.tsx", "utf8");
  assert.match(layout, /await getAdmin\(\)/);
  const actions = readFileSync("app/admin/actions.ts", "utf8");
  const exported = [...actions.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]);
  assert.ok(exported.length >= 15);
  for (const name of exported) {
    const body = actions.slice(actions.indexOf(`export async function ${name}(`)).split(/\nexport async function /)[0];
    assert.match(body, /return run\("(view|support|operate|export|owner)"/, `${name} must go through run() with a permission`);
  }
  // Client components never import server-only admin code or the service-role client.
  for (const f of files.filter((f) => f.endsWith(".tsx"))) {
    const src = readFileSync(f, "utf8");
    if (src.startsWith('"use client"')) {
      assert.doesNotMatch(src, /lib\/admin\/server|lib\/supabase\/admin|SUPABASE_SECRET|SERVICE_ROLE/, f);
      // Server pages receive client references, not values, for anything exported from a client module.
      assert.doesNotMatch(src, /^export (const|let|var) /m, `${f} must only export components from a client module`);
    }
  }
  for (const f of walk("app").filter((f) => /\.(tsx?)$/.test(f))) {
    const src = readFileSync(f, "utf8");
    assert.doesNotMatch(src, /NEXT_PUBLIC_[A-Z_]*(SECRET|SERVICE_ROLE)/, f);
  }
});
