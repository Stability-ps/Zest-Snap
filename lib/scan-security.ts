import "server-only";
import { distributedLimit } from "./rate-limit";
import { createHash } from "node:crypto";
import { isSupabaseConfigured } from "./supabase/config";
import { createClient } from "./supabase/server";
import { serviceClient } from "./supabase/admin";
const attempts = new Map<
  string,
  { count: number; reset: number; last: number; hash: string }
>();
export async function reserveScan(
  req: Request,
  requestId: string,
  dataUrl: string,
) {
  const hash = createHash("sha256").update(dataUrl).digest("hex");
  if (process.env.AI_SCANNING_ENABLED === "false")
    throw new Error("scanning_disabled");
  if (isSupabaseConfigured()) {
    const db = await createClient();
    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user) throw new Error("sign_in_required");
    const admin = serviceClient();
    const { data, error } = await admin.rpc("reserve_scan", {
      p_user: user.id,
      p_request: requestId,
      p_hash: hash,
    });
    if (error) {
      if (error.message.includes("allowance_exhausted"))
        throw new Error("allowance_exhausted");
      if (error.message.includes("repeat_request"))
        throw new Error("rate_limited");
      throw new Error("cloud_unavailable");
    }
    return { userId: user.id, pages: Number(data) || 3 };
  }
  // Per-instance fallback only. A distributed limiter is mandatory for unrestricted public local-mode scanning.
  // Vercel supplies x-vercel-forwarded-for; never use arbitrary client X-Forwarded-For on Vercel.
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
  if (distributed === true) return { userId: null, pages: 3 };
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
  return { userId: null, pages: 3 };
}
export function logScan(
  event: string,
  requestId: string,
  details: Record<string, string | number> = {},
) {
  console.info(JSON.stringify({ event, requestId, ...details }));
}
