import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { adminAccess, can, isAdminRole, type AdminRole, type Permission } from "./permissions";

export type AdminContext = {
  userId: string;
  email: string | null;
  name: string | null;
  role: AdminRole;
  /** False until the admin-console migration has been applied to this database. */
  schemaReady: boolean;
};

export type RpcResult<T> = { data: T; error: null } | { data: null; error: { code: string; message: string } };

const MESSAGES: Record<string, string> = {
  forbidden: "You don't have access to this.",
  forbidden_role: "Your admin role doesn't allow this action.",
  not_ready: "The admin database upgrade hasn't been applied yet.",
  not_found: "That record no longer exists.",
  invalid_range: "Choose a valid date range (up to 800 days).",
  invalid_plan: "Check the plan values — some are outside the allowed range.",
  invalid_field: "That field can't be changed here.",
  plan_in_use: "People are on this plan. Move them to another plan before deactivating it.",
  plan_unavailable: "That plan isn't active, so people can't be moved onto it yet.",
  free_plan_must_stay_free: "The Free plan must stay free and active.",
  invalid_amount: "Enter a credit amount between −1000 and 1000 (not zero).",
  insufficient_balance: "This would make the balance negative.",
  reason_required: "Add a short reason (at least 3 characters).",
  cannot_change_self: "You can't change your own account here.",
  cannot_disable_admin: "Remove admin access before disabling this account.",
  last_owner: "Zest Snap must always keep at least one Owner.",
  user_not_found: "No Zest Snap account uses that e-mail address.",
  invalid_role: "Choose a valid role.",
  invalid_assignee: "Tickets can only be assigned to admins.",
  invalid_tag: "Tags must be 1–30 characters.",
  message_required: "Write a message first.",
  invalid_content: "Keys use lowercase letters, numbers, - and _. Content must be 1–10,000 characters.",
  invalid_rule: "Reward amounts must be between 0 and 1000.",
  invalid_status: "Choose a valid status.",
  invalid_value: "That value is outside the allowed range.",
  archived: "Archived announcements can't be edited.",
  invalid_dataset: "Unknown export.",
  auth_update_failed: "The account status changed, but signing the person out failed. Try again.",
  unavailable: "Something went wrong loading this data. Try again in a moment.",
};

export function friendly(code: string) {
  return MESSAGES[code] || MESSAGES.unavailable;
}

function errorCode(error: { code?: string; message?: string } | null) {
  if (!error) return "unavailable";
  // PGRST202 / 42883: function missing → the migration has not been applied yet.
  if (error.code === "PGRST202" || error.code === "42883" || error.code === "PGRST205" || error.code === "42P01") return "not_ready";
  const known = Object.keys(MESSAGES).sort((a, b) => b.length - a.length).find((k) => error.message?.includes(k));
  return known || "unavailable";
}

/** Resolves and caches (per request) the signed-in admin. Redirects everyone else. */
export const getAdmin = cache(async (): Promise<AdminContext> => {
  if (!isSupabaseConfigured()) redirect("/app");
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login?next=/admin");
  // Reading one's own profile is allowed by RLS; every admin read/write is authorised again in the database.
  const { data: profile } = await db.from("profiles").select("is_admin, display_name").eq("id", user.id).maybeSingle();
  if (adminAccess(user, profile) !== "allowed") redirect("/app");
  const me = await db.rpc("admin_me" as never);
  const role = !me.error && isAdminRole((me.data as { role?: unknown } | null)?.role) ? ((me.data as { role: AdminRole }).role) : null;
  // Before the migration exists, admins keep today's capabilities (the old console had no roles).
  if (me.error && errorCode(me.error) !== "not_ready") redirect("/app");
  return {
    userId: user.id,
    email: user.email ?? null,
    name: (profile as { display_name?: string | null } | null)?.display_name ?? null,
    role: role ?? "admin",
    schemaReady: !me.error,
  };
});

export class AdminError extends Error {}

export async function requireAdmin(permission: Permission = "view") {
  const admin = await getAdmin();
  if (!can(admin.role, permission)) throw new AdminError("forbidden_role");
  return admin;
}

/** Calls an admin RPC with the admin's own session (the database re-checks the role). Never leaks raw errors. */
export async function adminRpc<T = any>(fn: string, args: Record<string, unknown> = {}): Promise<RpcResult<T>> {
  await getAdmin();
  const db = await createClient();
  const { data, error } = await db.rpc(fn as never, args as never);
  if (error) {
    const code = errorCode(error);
    if (code === "unavailable") console.error(JSON.stringify({ event: "admin_rpc_failed", fn, code: error.code }));
    return { data: null, error: { code, message: friendly(code) } };
  }
  return { data: data as T, error: null };
}

export const iso = (d: Date) => d.toISOString();
