import "server-only";
import { distributedLimit } from "./rate-limit";
import { createHash } from "node:crypto";
import { isSupabaseConfigured } from "./supabase/config";
import { createClient } from "./supabase/server";
import { serviceClient } from "./supabase/admin";
import type { ExtractionResult } from "./extraction-types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const attempts = new Map<
  string,
  { count: number; reset: number; last: number; hash: string }
>();

export type Reservation =
  | { kind: "account"; userId: string; pages: number }
  | { kind: "guest"; userId: null; pages: number; remaining: number }
  | { kind: "local"; userId: null; pages: number }
  | { kind: "cached"; userId: string | null; result: ExtractionResult };

/** Client-supplied ids make retries idempotent; anything malformed gets a fresh server id. */
export function requestIdFrom(req: Request) {
  const supplied = req.headers.get("x-request-id");
  return supplied && UUID.test(supplied) ? supplied.toLowerCase() : crypto.randomUUID();
}

// Known database exception names are passed through; anything else is treated as an outage.
const KNOWN = [
  "allowance_exhausted",
  "device_free_limit",
  "device_required",
  "device_rate_limited",
  "repeat_request",
  "scanning_disabled",
  "guest_trial_exhausted",
  "sign_in_required",
  "account_unavailable",
];
function mapRpcError(message: string) {
  return KNOWN.find((code) => message.includes(code)) || "cloud_unavailable";
}

function networkHash(req: Request) {
  // Vercel supplies x-vercel-forwarded-for; never trust arbitrary client X-Forwarded-For on Vercel.
  const ip = process.env.VERCEL
    ? req.headers.get("x-vercel-forwarded-for")
    : req.headers.get("x-forwarded-for");
  if (!ip) return null;
  // Rotates daily and is never stored with an account, so it cannot track people over time.
  const day = new Date().toISOString().slice(0, 10);
  return createHash("sha256").update(`zest-net:${ip.split(",")[0].trim()}:${day}`).digest("hex");
}

export async function reserveScan(
  req: Request,
  requestId: string,
  dataUrl: string,
): Promise<Reservation> {
  const hash = createHash("sha256").update(dataUrl).digest("hex");
  if (process.env.AI_SCANNING_ENABLED === "false")
    throw new Error("scanning_disabled");
  if (isSupabaseConfigured()) {
    const deviceId = req.headers.get("x-zest-device");
    if (!deviceId) throw new Error("device_required");
    const db = await createClient();
    const {
      data: { user },
    } = await db.auth.getUser();
    const admin = serviceClient();
    if (!user) {
      const { data, error } = await admin.rpc("reserve_guest_scan", {
        p_request: requestId,
        p_hash: hash,
        p_device_id: deviceId,
        p_network_hash: networkHash(req),
      });
      if (error) throw new Error(mapRpcError(error.message));
      const out = data as { cached?: ExtractionResult; pages?: number; remaining?: number };
      if (out.cached) return { kind: "cached", userId: null, result: out.cached };
      return { kind: "guest", userId: null, pages: Number(out.pages) || 3, remaining: Number(out.remaining) || 0 };
    }
    const cached = await admin.rpc("cached_scan_result", {
      p_user: user.id,
      p_hash: hash,
      p_request: requestId,
    });
    if (!cached.error && cached.data)
      return { kind: "cached", userId: user.id, result: cached.data as ExtractionResult };
    const { data, error } = await admin.rpc("reserve_scan", {
      p_user: user.id,
      p_request: requestId,
      p_hash: hash,
      p_device_id: deviceId,
    });
    if (error) throw new Error(mapRpcError(error.message));
    return { kind: "account", userId: user.id, pages: Number(data) || 3 };
  }
  // Per-instance fallback only. A distributed limiter is mandatory for unrestricted public local-mode scanning.
  const ip = process.env.VERCEL
    ? req.headers.get("x-vercel-forwarded-for")
    : req.headers.get("x-forwarded-for");
  const key = createHash("sha256")
    .update(ip || "unknown")
    .digest("hex");
  const now = Date.now();
  for (const [k, v] of attempts) if (v.reset < now) attempts.delete(k);
  const prior = attempts.get(key);
  const configured = Number(process.env.LOCAL_HOURLY_SCAN_LIMIT || 10);
  const limit = Number.isFinite(configured)
    ? Math.max(1, Math.min(100, configured))
    : 10;
  const distributed = await distributedLimit(key, hash, limit);
  if (distributed === false) throw new Error("rate_limited");
  if (distributed === true) return { kind: "local", userId: null, pages: 3 };
  if (
    prior &&
    (prior.count >= limit ||
      now - prior.last < 10000 ||
      (prior.hash === hash && now - prior.last < 60000))
  )
    throw new Error("rate_limited");
  if (attempts.size > 10000) throw new Error("rate_limited");
  attempts.set(key, {
    count: (prior?.count || 0) + 1,
    reset: prior?.reset || now + 3600000,
    last: now,
    hash,
  });
  return { kind: "local", userId: null, pages: 3 };
}

/** Records the outcome. Failed scans are refunded (allowance and any credits) by the database. */
export async function finishReservation(
  reservation: Reservation,
  requestId: string,
  outcome: { status: "completed" | "failed"; pages?: number; input?: number; output?: number; cost?: number | null; result?: unknown },
) {
  if (reservation.kind === "account") {
    const { error } = await serviceClient().rpc("finish_scan", {
      p_request: requestId,
      p_status: outcome.status,
      p_pages: outcome.pages || 0,
      p_input: outcome.input || 0,
      p_output: outcome.output || 0,
      p_cost: outcome.cost ?? null,
      p_result: outcome.status === "completed" ? outcome.result ?? null : null,
    });
    if (error) logScan("metering_write_failed", requestId, { status: outcome.status });
  } else if (reservation.kind === "guest") {
    const { error } = await serviceClient().rpc("finish_guest_scan", {
      p_request: requestId,
      p_status: outcome.status,
      p_result: outcome.status === "completed" ? outcome.result ?? null : null,
    });
    if (error) logScan("guest_metering_write_failed", requestId, { status: outcome.status });
  }
}

export type ScanMeta = {
  mimeType: string;
  pages: number;
  durationMs: number;
  eventCount?: number;
  warningCount?: number;
  errorCode?: string;
  model?: string;
};

/** Content-free operational metadata for the admin console. Best effort: never blocks or fails a scan. */
export async function recordScanMeta(reservation: Reservation, requestId: string, meta: ScanMeta) {
  if (reservation.kind !== "account" && reservation.kind !== "guest") return;
  const errorCode = meta.errorCode && /^[a-z_]{1,40}$/.test(meta.errorCode) ? meta.errorCode : null;
  try {
    const db = serviceClient();
    const { error } =
      reservation.kind === "account"
        ? await db.from("scan_requests").update({
            mime_type: meta.mimeType,
            page_count: meta.pages,
            event_count: meta.eventCount ?? null,
            warning_count: meta.warningCount ?? null,
            duration_ms: Math.max(0, Math.round(meta.durationMs)),
            error_code: errorCode,
            model: meta.model ? meta.model.slice(0, 80) : null,
          } as never).eq("id", requestId)
        : await db.from("guest_scan_usage").update({
            mime_type: meta.mimeType,
            event_count: meta.eventCount ?? null,
            duration_ms: Math.max(0, Math.round(meta.durationMs)),
            error_code: errorCode,
          } as never).eq("request_id", requestId);
    if (error) logScan("scan_meta_write_failed", requestId);
  } catch {
    logScan("scan_meta_write_failed", requestId);
  }
}

/** Structured, content-free server log line. Never pass document text, file names or tokens. */
export function logScan(
  event: string,
  requestId: string,
  details: Record<string, string | number | boolean> = {},
) {
  console.info(JSON.stringify({ event, requestId, ...details }));
}
