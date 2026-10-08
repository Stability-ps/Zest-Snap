import type { SupabaseClient } from "@supabase/supabase-js";

// Shared chat attachments live at shared-chat/<plan_id>/<sender_id>/<file>. Database cascades remove the
// message rows when a plan or account is deleted, but never the stored files, so these helpers list the
// folders directly (catching files whose message row is already gone) and remove them. Callers pass the service client.
const BUCKET = "shared-chat";
const PAGE = 1000;

async function list(admin: SupabaseClient, prefix: string) {
  const entries: { name: string; isFolder: boolean }[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin.storage.from(BUCKET).list(prefix, { limit: PAGE, offset });
    if (error) throw error;
    for (const e of data ?? []) entries.push({ name: e.name, isFolder: e.id === null });
    if (!data || data.length < PAGE) return entries;
  }
}

/** Every stored file for a plan, or only one member's uploads when userId is given. */
export async function sharedChatFiles(admin: SupabaseClient, planId: string, userId?: string) {
  const senders = userId ? [userId] : (await list(admin, planId)).filter((e) => e.isFolder).map((e) => e.name);
  const paths: string[] = [];
  for (const sender of senders) {
    for (const e of await list(admin, `${planId}/${sender}`)) if (!e.isFolder) paths.push(`${planId}/${sender}/${e.name}`);
  }
  return paths;
}

export async function removeSharedChatFiles(admin: SupabaseClient, paths: string[]) {
  for (let i = 0; i < paths.length; i += PAGE) {
    const { error } = await admin.storage.from(BUCKET).remove(paths.slice(i, i + PAGE));
    if (error) throw error;
  }
}
