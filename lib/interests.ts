import { INTEREST_IDS, INTRO_KEY, type InterestId } from "./intro";

/**
 * What the person wants Zest to help remember (picked in the first-run intro, editable in Settings › What you
 * snap). Kept on the device in the intro record and, for signed-in people, in profiles.preferences.interests so
 * every device matches. Used only to tailor the app itself (examples, reminder hints, scan hints); never shared.
 */
export type Interests = { list: InterestId[]; updatedAt: number };

export const INTEREST_LABELS: Record<InterestId, { emoji: string; label: string; hint: string }> = {
  school: { emoji: "🏫", label: "School & kids", hint: "Notices, newsletters" },
  health: { emoji: "🩺", label: "Health", hint: "Doctor, dentist" },
  work: { emoji: "💼", label: "Work", hint: "Meetings, deadlines" },
  bills: { emoji: "🧾", label: "Bills & renewals", hint: "Licences, payments" },
  events: { emoji: "🎟️", label: "Events", hint: "Invites, tickets" },
  travel: { emoji: "✈️", label: "Travel", hint: "Flights, bookings" },
};

const clean = (v: unknown): InterestId[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is InterestId => (INTEREST_IDS as readonly string[]).includes(x as string)))] : [];

export function parseInterests(raw: unknown): Interests | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const updatedAt = typeof r.updatedAt === "number" && Number.isFinite(r.updatedAt) ? r.updatedAt : 0;
  return { list: clean(r.list), updatedAt };
}

/** Device copy, stored inside the intro record ({ interests, at }). */
export function readLocalInterests(storage: Pick<Storage, "getItem"> = localStorage): Interests {
  try {
    const s = JSON.parse(storage.getItem(INTRO_KEY) || "null");
    if (s && typeof s === "object") return { list: clean(s.interests), updatedAt: Date.parse(s.at) || 0 };
  } catch {}
  return { list: [], updatedAt: 0 };
}

export function writeLocalInterests(next: Interests, storage: Pick<Storage, "getItem" | "setItem"> = localStorage) {
  try {
    const s = JSON.parse(storage.getItem(INTRO_KEY) || "null") || {};
    storage.setItem(INTRO_KEY, JSON.stringify({ v: 1, done: true, ...s, interests: next.list, at: new Date(next.updatedAt || Date.now()).toISOString() }));
    window.dispatchEvent(new Event("zest-interests-changed"));
  } catch {
    // Storage blocked: the choice still applies to this screen.
  }
}

/** The newer of the two copies wins; returns what to apply locally and/or push to the account. */
export function reconcileInterests(local: Interests, remote: Interests | null): { apply?: Interests; push?: Interests } {
  if (!remote) return local.list.length ? { push: local } : {};
  if (remote.updatedAt > local.updatedAt) return { apply: remote };
  if (local.updatedAt > remote.updatedAt) return { push: local };
  return {};
}

type ProfilesDb = {
  from(table: "profiles"): {
    select(columns: "preferences"): { eq(column: "id", value: string): { maybeSingle(): PromiseLike<{ data: { preferences: unknown } | null; error: { message: string } | null }> } };
    update(values: { preferences: Record<string, unknown> }): { eq(column: "id", value: string): PromiseLike<{ error: { message: string } | null }> };
  };
};

/** One sync round with profiles.preferences.interests (merging so other preferences are kept). Never throws. */
export async function syncInterests(db: ProfilesDb, userId: string) {
  try {
    const { data, error } = await db.from("profiles").select("preferences").eq("id", userId).maybeSingle();
    if (error) return;
    const prefs = data?.preferences && typeof data.preferences === "object" && !Array.isArray(data.preferences) ? (data.preferences as Record<string, unknown>) : {};
    const plan = reconcileInterests(readLocalInterests(), parseInterests(prefs.interests));
    if (plan.apply) writeLocalInterests(plan.apply);
    if (plan.push) await db.from("profiles").update({ preferences: { ...prefs, interests: plan.push } }).eq("id", userId);
  } catch {
    // Offline or signed out: the device copy stays and the next sync retries.
  }
}

/** "What can I snap?" examples on Home: the person's interests first, then the usual defaults, three in all. */
export const SNAP_EXAMPLES: Record<InterestId, { emoji: string; text: string }> = {
  school: { emoji: "🏫", text: "School notices and newsletters" },
  health: { emoji: "🩺", text: "Appointment cards and booking emails" },
  events: { emoji: "🎟️", text: "Invitations, posters and tickets" },
  work: { emoji: "💼", text: "Meeting invites and project deadlines" },
  bills: { emoji: "🧾", text: "Bills, licence renewals and statements" },
  travel: { emoji: "✈️", text: "Flight and hotel booking confirmations" },
};
const DEFAULT_EXAMPLES: InterestId[] = ["school", "health", "events"];

export function snapExamples(interests: InterestId[]) {
  const order = [...INTEREST_IDS.filter((id) => interests.includes(id)), ...DEFAULT_EXAMPLES];
  return [...new Set(order)].slice(0, 3).map((id) => ({ id, ...SNAP_EXAMPLES[id] }));
}
