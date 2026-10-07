import { NextResponse } from "next/server";

export const runtime = "nodejs";

const originOf = (v: unknown) => {
  if (typeof v !== "string" || !v) return "";
  if (!v.includes(":")) return v.slice(0, 40); // keywords such as "inline" or "eval"
  try {
    return new URL(v).origin;
  } catch {
    return v.split(":")[0].slice(0, 20);
  }
};

/**
 * Receives CSP (Report-Only) violation reports. Logs only the directive, the blocked origin and the page path
 * (with ids/tokens redacted) — never full URLs, query strings or sample content, which could carry personal data.
 */
export async function POST(req: Request) {
  const raw = await req.text().catch(() => "");
  if (raw.length > 16_000) return new NextResponse(null, { status: 413 });
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse(null, { status: 204 });
  }
  const reports = Array.isArray(body) ? body.map((r) => r?.body) : [(body as { "csp-report"?: unknown })?.["csp-report"]];
  for (const r of reports.slice(0, 10) as Record<string, unknown>[]) {
    if (!r) continue;
    let page = "";
    try {
      // Invite tokens and plan ids in paths are credentials/identifiers: replace any UUID with ":id".
      page = new URL(String(r["document-uri"] ?? r.documentURL ?? "")).pathname.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id").slice(0, 80);
    } catch {}
    console.info(
      JSON.stringify({
        event: "csp_violation",
        directive: String(r["effective-directive"] ?? r.effectiveDirective ?? r["violated-directive"] ?? "").slice(0, 40),
        blocked: originOf(r["blocked-uri"] ?? r.blockedURL),
        page,
      }),
    );
  }
  return new NextResponse(null, { status: 204 });
}
