import { NextResponse, type NextRequest } from "next/server";
import { AdminError, friendly, requireAdmin } from "@/lib/admin/server";
import { createClient } from "@/lib/supabase/server";
import { csvFilename, csvRow } from "@/lib/admin/csv";
import { exportByKey } from "@/lib/admin/exports";
import { parseRange } from "@/lib/admin/range";

export const dynamic = "force-dynamic";
const PAGE = 1000;
const MAX_ROWS = 250_000;

/** Server-generated CSV, streamed page by page (keyset pagination), so large exports never load into the browser. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ dataset: string }> }) {
  const { dataset } = await ctx.params;
  const def = exportByKey(dataset);
  if (!def) return NextResponse.json({ error: "Unknown export" }, { status: 404 });
  try {
    await requireAdmin("export");
  } catch (e) {
    const code = e instanceof AdminError ? e.message : "forbidden";
    return NextResponse.json({ error: friendly(code) }, { status: 403 });
  }
  const sp = req.nextUrl.searchParams;
  const range = parseRange({ range: sp.get("range") || "30d", from: sp.get("from") || undefined, to: sp.get("to") || undefined });
  const db = await createClient();
  const p = { p_from: range.from.toISOString(), p_to: range.to.toISOString() };

  // Fetch the first page before streaming so permission or upgrade errors return a proper status, not a broken file.
  let first: Record<string, unknown>[];
  if (def.key === "revenue_summary") {
    const { data, error } = await db.rpc("admin_revenue" as never, p as never);
    if (error) return NextResponse.json({ error: friendly(error.code === "PGRST202" ? "not_ready" : "unavailable") }, { status: 500 });
    first = ((data as any)?.by_currency || []).map((r: any) => ({ ...r, failed_payments: r.failed, paying_users: r.payers }));
  } else {
    const { data, error } = await db.rpc("admin_export" as never, { p_dataset: def.key, ...p, p_after_at: null, p_after_id: null, p_limit: PAGE } as never);
    if (error) return NextResponse.json({ error: friendly(error.code === "PGRST202" ? "not_ready" : "unavailable") }, { status: 500 });
    first = (data as Record<string, unknown>[]) || [];
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode("﻿" + csvRow(def.columns)));
      let page = first, sent = 0;
      try {
        while (page.length) {
          let chunk = "";
          for (const row of page) chunk += csvRow(def.columns.map((c) => row[c]));
          controller.enqueue(encoder.encode(chunk));
          sent += page.length;
          if (def.key === "revenue_summary" || page.length < PAGE || sent >= MAX_ROWS) break;
          const last = page[page.length - 1];
          const { data, error } = await db.rpc("admin_export" as never, { p_dataset: def.key, ...p, p_after_at: last.at_, p_after_id: last.id_, p_limit: PAGE } as never);
          if (error) throw new Error("export_page_failed");
          page = (data as Record<string, unknown>[]) || [];
        }
        controller.close();
      } catch {
        controller.error(new Error("Export interrupted"));
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csvFilename(def.key, range.from, range.to)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
