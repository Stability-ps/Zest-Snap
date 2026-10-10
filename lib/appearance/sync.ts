import { parseAppearance, type Appearance, type StoredAppearance } from "./preferences";

/**
 * Account sync for appearance. The device copy is always applied first (offline-safe, no network on the
 * theme switch); this module reconciles it with profiles.preferences.appearance afterwards.
 *
 * Rules:
 *  - Signing in to an account that has a saved appearance adopts it (each account keeps its own choice).
 *  - An account without one (new account, or saved before this feature) receives this device's choice.
 *  - Same account on both sides: the newer change wins (updatedAt), so an offline change uploads later
 *    unless another device changed it more recently.
 *  - Values that came from the account are never uploaded back, so devices cannot ping-pong.
 */
export interface AppearanceRemote {
  load(): Promise<Appearance | null>;
  save(value: Appearance): Promise<void>;
}

export type SyncPlan = { apply?: StoredAppearance; push?: Appearance };

export function reconcile(local: StoredAppearance, remote: Appearance | null, userId: string): SyncPlan {
  const pick = ({ mode, accent, updatedAt }: Appearance): Appearance => ({ mode, accent, updatedAt });
  if (local.owner !== userId) {
    if (remote) return { apply: { ...pick(remote), owner: userId, dirty: false } };
    const seeded = { ...pick(local), updatedAt: local.updatedAt || Date.now() };
    return { apply: { ...seeded, owner: userId, dirty: true }, push: seeded };
  }
  if (!remote) return { push: pick(local) };
  if (local.dirty && local.updatedAt > remote.updatedAt) return { push: pick(local) };
  if (remote.updatedAt > local.updatedAt || remote.mode !== local.mode || remote.accent !== local.accent)
    return { apply: { ...pick(remote), owner: userId, dirty: false } };
  return local.dirty ? { apply: { ...local, dirty: false } } : {};
}

type ProfilesDb = {
  from(table: "profiles"): {
    select(columns: "preferences"): { eq(column: "id", value: string): { maybeSingle(): PromiseLike<{ data: { preferences: unknown } | null; error: { message: string } | null }> } };
    update(values: { preferences: Record<string, unknown> }): { eq(column: "id", value: string): PromiseLike<{ error: { message: string } | null }> };
  };
};

/** profiles.preferences.appearance for one signed-in account. RLS limits both calls to the person's own row. */
export function supabaseAppearanceRemote(db: ProfilesDb, userId: string): AppearanceRemote {
  const readPreferences = async () => {
    const { data, error } = await db.from("profiles").select("preferences").eq("id", userId).maybeSingle();
    if (error) throw new Error(error.message);
    const prefs = data?.preferences;
    return prefs && typeof prefs === "object" && !Array.isArray(prefs) ? (prefs as Record<string, unknown>) : {};
  };
  return {
    async load() {
      return parseAppearance((await readPreferences()).appearance);
    },
    async save(value) {
      // Merge so the other preferences (reminders, retention, …) are kept.
      const prefs = await readPreferences();
      const { error } = await db
        .from("profiles")
        .update({ preferences: { ...prefs, appearance: { mode: value.mode, accent: value.accent, updatedAt: value.updatedAt } } })
        .eq("id", userId);
      if (error) throw new Error(error.message);
    },
  };
}

export type SyncResult = "applied" | "pushed" | "unchanged" | "failed";

/**
 * Runs one reconcile round. `read`/`replace` access the device copy (re-read after the network call so a
 * change made while the request was in flight is never overwritten).
 */
export async function syncAppearanceOnce(opts: {
  userId: string;
  remote: AppearanceRemote;
  read: () => StoredAppearance;
  replace: (next: StoredAppearance) => void;
}): Promise<SyncResult> {
  const { userId, remote, read, replace } = opts;
  let remoteValue: Appearance | null;
  try {
    remoteValue = await remote.load();
  } catch {
    return "failed";
  }
  const before = read();
  const plan = reconcile(before, remoteValue, userId);
  if (plan.apply) replace(plan.apply);
  if (!plan.push) return plan.apply ? "applied" : "unchanged";
  try {
    await remote.save(plan.push);
  } catch {
    // Keep it dirty and owned by this account: the next sync (online event, resume, next launch) retries.
    const now = read();
    if (now.updatedAt === plan.push.updatedAt) replace({ ...now, owner: userId, dirty: true });
    return "failed";
  }
  const after = read();
  if (after.updatedAt === plan.push.updatedAt && after.mode === plan.push.mode && after.accent === plan.push.accent)
    replace({ ...after, owner: userId, dirty: false });
  return "pushed";
}
