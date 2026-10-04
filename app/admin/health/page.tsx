import Link from "next/link";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { adminRpc, getAdmin } from "@/lib/admin/server";
import { fmtDateTime, fmtNumber, fmtRelative, humanize } from "@/lib/admin/format";
import { Badge, Card, DevDetails, PageHeader } from "../_components/ui";

export const metadata = { title: "System Health" };
type Level = "healthy" | "warning" | "issue";
type Check = { name: string; level: Level; detail: string; href?: string };

function level(bad: boolean, warn: boolean): Level {
  return bad ? "issue" : warn ? "warning" : "healthy";
}

function Row({ c }: { c: Check }) {
  const Icon = c.level === "healthy" ? CheckCircle2 : c.level === "warning" ? AlertTriangle : XCircle;
  const color = c.level === "healthy" ? "var(--ad-good)" : c.level === "warning" ? "var(--ad-warn)" : "var(--ad-bad)";
  return (
    <div className="ad-health">
      <Icon size={20} color={color} aria-hidden />
      <div className="grow"><b>{c.name}</b><p>{c.detail}</p></div>
      <Badge tone={c.level === "healthy" ? "good" : c.level === "warning" ? "warn" : "bad"}>{c.level === "healthy" ? "Healthy" : c.level === "warning" ? "Warning" : "Issue"}</Badge>
      {c.href && <Link className="ad-btn ad-btn-sm ad-hide-sm" href={c.href}>View</Link>}
    </div>
  );
}

/** Presence checks only — values are never read into the page. */
const has = (...names: string[]) => names.some((n) => !!process.env[n]);

async function timedHealth() {
  const started = performance.now();
  const res = await adminRpc<any>("admin_health");
  return { res, dbMs: Math.round(performance.now() - started) };
}

export default async function HealthPage() {
  await getAdmin();
  const { res, dbMs } = await timedHealth();
  const h = res.data;
  const checks: Check[] = [];
  checks.push({ name: "Database", level: res.error && res.error.code !== "not_ready" ? "issue" : level(false, dbMs > 1500), detail: res.error && res.error.code !== "not_ready" ? "Admin queries are failing." : `Responding (${dbMs} ms round trip).` });
  checks.push({ name: "Authentication", level: "healthy", detail: "Your admin session was verified with Supabase Auth on this request." });
  if (h) {
    const accFail = Number(h.failed_scans_24h), acc = Number(h.scans_24h);
    const rate = acc ? accFail / acc : 0;
    checks.push({ name: "AI scanning", href: "/admin/scans?status=failed&range=today",
      level: !h.flags?.ai_scanning ? "warning" : level(acc >= 5 && rate > 0.5, accFail > 0 && rate > 0.15),
      detail: `${h.flags?.ai_scanning ? "Enabled" : "Turned OFF by flag"} · ${fmtNumber(acc)} signed-in scans in 24h, ${fmtNumber(accFail)} failed · ${fmtNumber(h.guest_scans_24h)} guest scans, ${fmtNumber(h.guest_failed_24h)} failed.` });
    checks.push({ name: "Stuck scans", level: level(Number(h.stuck_scans) > 3, Number(h.stuck_scans) > 0), detail: `${fmtNumber(h.stuck_scans)} requests reserved for more than 10 minutes (expired automatically by a scheduled job).` });
    checks.push({ name: "Recent API errors", href: "/admin/ai", level: level(false, h.recent_errors.length > 0),
      detail: h.recent_errors.length ? h.recent_errors.map((e: any) => `${humanize(e.error_code)} × ${e.n}`).join(" · ") + " (7 days)" : "No recorded scan errors in 7 days." });
    checks.push({ name: "Reminder delivery", href: "/admin/reminders", level: level(Number(h.reminders_overdue) > 10, Number(h.reminders_failed_24h) > 0 || Number(h.reminders_overdue) > 0),
      detail: `${fmtNumber(h.reminders_failed_24h)} failed in 24h · ${fmtNumber(h.reminders_overdue)} overdue · last delivered ${fmtRelative(h.reminders_last_sent)}${h.reminder_errors.length ? ` · ${h.reminder_errors.map((e: any) => `${e.error} × ${e.n}`).join(", ")}` : ""}.` });
    checks.push({ name: "Push notifications", level: !h.flags?.push_notifications ? "warning" : level(false, Number(h.push_failing) > 0),
      detail: `${h.flags?.push_notifications ? "Enabled" : "Off"} · ${fmtNumber(h.push_subscriptions)} devices · ${fmtNumber(h.push_failing)} with recent delivery failures.` });
    const jobs: any[] = h.cron_jobs || [];
    checks.push({ name: "Scheduled jobs", level: level(false, !jobs.length || jobs.some((j) => !j.active)),
      detail: jobs.length ? jobs.map((j) => `${j.name} (${j.schedule})${j.active ? "" : " — paused"}`).join(" · ") : "No scheduled jobs visible." });
    checks.push({ name: "Calendar integrations", href: "/admin/calendar", level: h.flags?.direct_google_calendar && !has("GOOGLE_CLIENT_ID") ? "issue" : "healthy",
      detail: `${fmtNumber(h.calendar_connections)} direct connections · Google sync ${h.flags?.direct_google_calendar ? "enabled" : "off"}.` });
  }
  const config: Check[] = [
    { name: "OpenAI API key", level: has("OPENAI_API_KEY") ? "healthy" : "issue", detail: has("OPENAI_API_KEY") ? "Configured" : "Missing — scanning cannot run." },
    { name: "Supabase server key", level: has("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY") ? "healthy" : "issue", detail: has("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY") ? "Configured (server only)" : "Missing — metering and rewards fail closed." },
    { name: "AI cost rates", level: has("OPENAI_INPUT_USD_PER_MILLION") && has("OPENAI_OUTPUT_USD_PER_MILLION") ? "healthy" : "warning", detail: has("OPENAI_INPUT_USD_PER_MILLION") && has("OPENAI_OUTPUT_USD_PER_MILLION") ? "Configured" : "Not set — AI cost is not estimated." },
    { name: "Web push (VAPID)", level: has("NEXT_PUBLIC_VAPID_PUBLIC_KEY") ? "healthy" : "warning", detail: has("NEXT_PUBLIC_VAPID_PUBLIC_KEY") ? "Public key configured; private key lives with the delivery job." : "Not configured in this deployment." },
    { name: "Google OAuth", level: has("GOOGLE_CLIENT_ID") && has("GOOGLE_CLIENT_SECRET") ? "healthy" : "warning", detail: has("GOOGLE_CLIENT_ID") && has("GOOGLE_CLIENT_SECRET") ? "Configured" : "Not configured." },
    { name: "Payments", level: "warning", detail: "No payment provider connected." },
    { name: "Scanning kill switch", level: process.env.AI_SCANNING_ENABLED === "false" ? "issue" : "healthy", detail: process.env.AI_SCANNING_ENABLED === "false" ? "AI_SCANNING_ENABLED=false — scanning is disabled at the server." : "Not engaged." },
  ];
  const all = [...checks, ...config];
  const overall: Level = all.some((c) => c.level === "issue") ? "issue" : all.some((c) => c.level === "warning") ? "warning" : "healthy";
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  return (
    <>
      <PageHeader title="System Health" description="Operational checks measured on this request. Secret values are never displayed."
        actions={<Badge tone={overall === "healthy" ? "good" : overall === "warning" ? "warn" : "bad"}>{overall === "healthy" ? "All systems healthy" : overall === "warning" ? "Some warnings" : "Issues detected"}</Badge>} />
      <div className="ad-grid ad-grid-21">
        <Card title="Services" flush><div>{checks.map((c) => <Row key={c.name} c={c} />)}</div></Card>
        <div className="ad-grid" style={{ alignContent: "start" }}>
          <Card title="Deployment">
            <dl className="ad-kv">
              <dt>Environment</dt><dd>{process.env.VERCEL_ENV || "local"}</dd>
              <dt>Commit</dt><dd className="ad-mono">{sha ? sha.slice(0, 12) : "—"}</dd>
              <dt>Branch</dt><dd>{process.env.VERCEL_GIT_COMMIT_REF || "—"}</dd>
              <dt>Region</dt><dd>{process.env.VERCEL_REGION || "—"}</dd>
              <dt>Checked</dt><dd>{h?.database_time ? fmtDateTime(h.database_time) : "—"}</dd>
            </dl>
          </Card>
          <Card title="Configuration" description="Presence checks only" flush><div>{config.map((c) => <Row key={c.name} c={c} />)}</div></Card>
        </div>
      </div>
      {h && <Card title="Feature flags snapshot"><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{Object.entries(h.flags || {}).map(([k, v]) => <Badge key={k} tone={v ? "good" : "neutral"}>{k}: {v ? "on" : "off"}</Badge>)}</div><DevDetails data={h} /></Card>}
    </>
  );
}
