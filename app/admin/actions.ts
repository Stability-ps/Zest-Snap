"use server";
import { revalidatePath } from "next/cache";
import { AdminError, adminRpc, friendly, requireAdmin } from "@/lib/admin/server";
import type { Permission } from "@/lib/admin/permissions";
import { serviceClient } from "@/lib/supabase/admin";
import type { ActionState } from "./_components/forms";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (f: FormData, k: string, max = 5000) => String(f.get(k) ?? "").trim().slice(0, max);
const uuid = (f: FormData, k: string) => {
  const v = str(f, k, 64);
  if (!UUID.test(v)) throw new AdminError("not_found");
  return v;
};
const int = (f: FormData, k: string) => {
  const raw = str(f, k, 20);
  const n = Number(raw);
  if (raw === "" || !Number.isInteger(n)) throw new AdminError("invalid_value");
  return n;
};
const num = (f: FormData, k: string) => {
  const raw = str(f, k, 20);
  const n = Number(raw);
  if (raw === "" || !Number.isFinite(n)) throw new AdminError("invalid_value");
  return n;
};
const bool = (f: FormData, k: string) => f.get(k) === "on" || f.get(k) === "true";
const oneOf = <T extends string>(v: string, allowed: readonly T[]) => {
  if (!(allowed as readonly string[]).includes(v)) throw new AdminError("invalid_status");
  return v as T;
};

/** Shared wrapper: role check → audited RPC → revalidate. Errors become friendly messages, never raw SQL. */
async function run(permission: Permission, work: () => Promise<string>, paths: string[] = []): Promise<ActionState> {
  try {
    await requireAdmin(permission);
    const message = await work();
    for (const p of paths) revalidatePath(p);
    return { ok: true, message, at: Date.now() };
  } catch (e) {
    const code = e instanceof Error ? e.message : "unavailable";
    return { ok: false, message: friendly(code), at: Date.now() };
  }
}

async function rpc(fn: string, args: Record<string, unknown>) {
  const res = await adminRpc(fn, args);
  if (res.error) throw new AdminError(res.error.code);
  return res.data;
}

export async function setFlag(_: ActionState, f: FormData) {
  const key = str(f, "key", 80);
  const enabled = f.get("enabled") === "true";
  return run("operate", async () => {
    await rpc("admin_set_flag", { p_key: key, p_enabled: enabled });
    return `${key.replaceAll("_", " ")} turned ${enabled ? "on" : "off"}`;
  }, ["/admin/flags", "/admin/health"]);
}

export async function updatePlan(_: ActionState, f: FormData) {
  return run("operate", async () => {
    const id = oneOf(str(f, "id", 20), ["free", "plus", "business"] as const);
    const annual = str(f, "annual_price", 20);
    const patch: Record<string, unknown> = {
      name: str(f, "name", 40),
      description: str(f, "description", 300),
      monthly_scans: int(f, "monthly_scans"),
      pdf_pages: int(f, "pdf_pages"),
      credits_per_bonus_scan: int(f, "credits_per_bonus_scan"),
      smart_reminders: bool(f, "smart_reminders"),
      bulk_extraction: bool(f, "bulk_extraction"),
      priority_processing: bool(f, "priority_processing"),
      calendar_integrations: bool(f, "calendar_integrations"),
      rewards_multiplier: num(f, "rewards_multiplier"),
      recommended: bool(f, "recommended"),
      display_order: int(f, "display_order"),
    };
    // Commercial fields are only sent by Owners' forms; the database re-checks ownership regardless.
    if (f.has("monthly_price")) {
      patch.monthly_price = num(f, "monthly_price");
      patch.annual_price = annual === "" ? null : num(f, "annual_price");
      patch.currency = str(f, "currency", 3).toUpperCase();
      patch.active = bool(f, "active");
      patch.is_public = bool(f, "is_public");
    }
    await rpc("admin_update_plan", { p_id: id, p_patch: patch });
    revalidatePath("/");
    return `${patch.name} saved — pricing page and allowances updated`;
  }, ["/admin/plans"]);
}

export async function updateRewardRule(_: ActionState, f: FormData) {
  return run("operate", async () => {
    await rpc("admin_update_reward_rule", { p_key: str(f, "key", 60), p_amount: int(f, "amount"), p_enabled: bool(f, "enabled"), p_label: str(f, "label", 60) });
    return "Reward rule saved";
  }, ["/admin/rewards/rules", "/admin/rewards"]);
}

export async function adjustCredits(_: ActionState, f: FormData) {
  return run("operate", async () => {
    const user = uuid(f, "user");
    const amount = int(f, "amount") * (f.get("direction") === "revoke" ? -1 : 1);
    const out = await rpc("admin_adjust_credits", { p_user: user, p_amount: amount, p_reason: str(f, "reason", 200) });
    revalidatePath(`/admin/users/${user}`);
    return `Credits ${amount > 0 ? "added" : "revoked"} · new balance ${out.balance}`;
  });
}

export async function setUserPlan(_: ActionState, f: FormData) {
  return run("operate", async () => {
    const user = uuid(f, "user");
    await rpc("admin_set_user_plan", { p_user: user, p_plan: oneOf(str(f, "plan", 20), ["free", "plus", "business"] as const), p_reason: str(f, "reason", 200) });
    revalidatePath(`/admin/users/${user}`);
    return "Plan changed";
  }, ["/admin/users"]);
}

/**
 * Disabling records the status (audited) and blocks sign-in at the auth layer with the server-only key,
 * which also stops token refresh. If the auth call fails the status change is rolled back.
 */
export async function setAccountStatus(_: ActionState, f: FormData) {
  return run("operate", async () => {
    const user = uuid(f, "user");
    const status = oneOf(str(f, "status", 20), ["active", "disabled"] as const);
    const reason = str(f, "reason", 200);
    const out = await rpc("admin_set_account_status", { p_user: user, p_status: status, p_reason: reason });
    try {
      const { error } = await serviceClient().auth.admin.updateUserById(user, { ban_duration: status === "disabled" ? "876000h" : "none" });
      if (error) throw error;
    } catch {
      await rpc("admin_set_account_status", { p_user: user, p_status: out.previous, p_reason: "Automatic rollback: sign-in block failed" }).catch(() => undefined);
      throw new AdminError("auth_update_failed");
    }
    revalidatePath(`/admin/users/${user}`);
    return status === "disabled" ? "Account disabled and signed out" : "Account reactivated";
  }, ["/admin/users"]);
}

export async function setSupportFlag(_: ActionState, f: FormData) {
  return run("support", async () => {
    const user = uuid(f, "user");
    await rpc("admin_set_support_flag", { p_user: user, p_flag: bool(f, "flag"), p_note: str(f, "note", 1000) });
    revalidatePath(`/admin/users/${user}`);
    return bool(f, "flag") ? "Account marked for support" : "Support mark removed";
  });
}

export async function grantRole(_: ActionState, f: FormData) {
  return run("owner", async () => {
    await rpc("admin_grant_role", { p_email: str(f, "email", 320), p_role: oneOf(str(f, "role", 20), ["owner", "admin", "support", "analyst"] as const) });
    return "Admin access updated";
  }, ["/admin/admins"]);
}

export async function revokeRole(_: ActionState, f: FormData) {
  return run("owner", async () => {
    await rpc("admin_revoke_role", { p_user: uuid(f, "user") });
    return "Admin access removed";
  }, ["/admin/admins"]);
}

const ticketStatuses = ["new", "open", "waiting", "resolved", "closed"] as const;
const priorities = ["low", "normal", "high", "urgent"] as const;
const categories = ["account", "billing", "scan", "planner", "reminder", "calendar", "app", "suggestion", "other"] as const;

export async function updateTicket(_: ActionState, f: FormData) {
  return run("support", async () => {
    const id = uuid(f, "id");
    const patch: Record<string, unknown> = {};
    if (f.has("status")) patch.status = oneOf(str(f, "status"), ticketStatuses);
    if (f.has("priority")) patch.priority = oneOf(str(f, "priority"), priorities);
    if (f.has("category")) patch.category = oneOf(str(f, "category"), categories);
    if (f.has("assignee_id")) patch.assignee_id = str(f, "assignee_id") ? uuid(f, "assignee_id") : null;
    if (f.has("tags"))
      patch.tags = [...new Set(str(f, "tags", 400).split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 10);
    await rpc("admin_ticket_update", { p_id: id, p_patch: patch });
    return "Ticket updated";
  }, ["/admin/support"]);
}

export async function replyTicket(_: ActionState, f: FormData) {
  return run("support", async () => {
    const internal = f.get("mode") === "note";
    await rpc("admin_ticket_reply", { p_id: uuid(f, "id"), p_body: str(f, "body", 5000), p_internal: internal });
    return internal ? "Internal note added" : "Reply sent";
  }, ["/admin/support"]);
}

export async function updateReport(_: ActionState, f: FormData) {
  return run("support", async () => {
    const patch: Record<string, unknown> = {};
    if (f.has("status")) patch.status = oneOf(str(f, "status"), ["new", "triaged", "in_progress", "resolved", "wont_fix"] as const);
    if (f.has("priority")) patch.priority = oneOf(str(f, "priority"), priorities);
    if (f.has("assignee_id")) patch.assignee_id = str(f, "assignee_id") ? uuid(f, "assignee_id") : null;
    await rpc("admin_report_update", { p_id: uuid(f, "id"), p_patch: patch });
    return "Report updated";
  }, ["/admin/reports"]);
}

export async function addReportNote(_: ActionState, f: FormData) {
  return run("support", async () => {
    await rpc("admin_report_note", { p_id: uuid(f, "id"), p_body: str(f, "body", 4000) });
    return "Note added";
  }, ["/admin/reports"]);
}

export async function updateFeedback(_: ActionState, f: FormData) {
  return run("support", async () => {
    await rpc("admin_feedback_update", {
      p_id: uuid(f, "id"),
      p_status: oneOf(str(f, "status"), ["new", "reviewed", "planned", "resolved", "archived"] as const),
      p_note: str(f, "note", 2000),
    });
    return "Feedback updated";
  }, ["/admin/feedback", "/admin/ratings"]);
}

export async function saveContent(_: ActionState, f: FormData) {
  return run("operate", async () => {
    await rpc("admin_save_content", { p_key: str(f, "key", 60).toLowerCase(), p_body: str(f, "body", 10000) });
    return "Draft saved";
  }, ["/admin/content"]);
}

export async function deleteContent(_: ActionState, f: FormData) {
  return run("operate", async () => {
    await rpc("admin_delete_content", { p_key: str(f, "key", 60) });
    return "Draft deleted";
  }, ["/admin/content"]);
}

export async function saveAnnouncement(_: ActionState, f: FormData) {
  return run("operate", async () => {
    const id = str(f, "id", 64);
    const audience = oneOf(str(f, "audience"), ["all", "free", "plus", "business", "selected"] as const);
    const ids = str(f, "user_ids", 20000).split(/[\s,]+/).filter(Boolean);
    if (ids.some((x) => !UUID.test(x)) || ids.length > 500) throw new AdminError("invalid_value");
    const when = (k: string) => {
      const v = str(f, k, 40);
      if (!v) return "";
      // datetime-local has no zone; the form labels it UTC, so interpret it as UTC.
      const d = new Date(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? v + ":00Z" : v);
      if (Number.isNaN(d.getTime())) throw new AdminError("invalid_value");
      return d.toISOString();
    };
    const title = str(f, "title", 120), body = str(f, "body", 2000);
    if (!title || !body) throw new AdminError("message_required");
    await rpc("admin_save_announcement", {
      p_id: id ? (UUID.test(id) ? id : (() => { throw new AdminError("not_found"); })()) : null,
      p_data: { title, body, audience, user_ids: audience === "selected" ? ids : [], starts_at: when("starts_at"), ends_at: when("ends_at") },
    });
    return "Announcement draft saved";
  }, ["/admin/notifications"]);
}

export async function setAnnouncementStatus(_: ActionState, f: FormData) {
  return run("operate", async () => {
    const status = oneOf(str(f, "status"), ["draft", "published", "archived"] as const);
    await rpc("admin_set_announcement_status", { p_id: uuid(f, "id"), p_status: status });
    return status === "published" ? "Announcement published" : status === "archived" ? "Announcement archived" : "Moved back to draft";
  }, ["/admin/notifications"]);
}

export async function updateLimit(_: ActionState, f: FormData) {
  return run("owner", async () => {
    await rpc("admin_update_limit", { p_key: str(f, "key", 80), p_value: int(f, "value") });
    return "Limit saved";
  }, ["/admin/settings"]);
}
