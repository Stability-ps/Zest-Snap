import { createClient, isSupabaseConfigured } from "../supabase/client";
import { LocalDataProvider, STORAGE_KEY } from "./local";
import { PlannerStore } from "../planner-store";
import { migrateGuestReminders } from "../reminders";
import { activeUser } from "../session";
import { CachedCloudProvider } from "./cached";
import { SupabaseDataProvider } from "./cloud";
import { emptyState, type DataProvider, type LocalState } from "./types";
import { eventFingerprint } from "../events";
export * from "./types";
export { LocalDataProvider } from "./local";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cloudProvider = (db: ReturnType<typeof createClient>, userId: string) =>
  new CachedCloudProvider(new SupabaseDataProvider(db, userId), "zest-cloud-" + userId, localStorage);

/**
 * Opens storage from the locally stored session (no network round trip) so cached data can render
 * immediately. Call verifyAccount() afterwards: the server remains the authority for every write.
 */
export async function getDataProvider(): Promise<DataProvider> {
  if (!isSupabaseConfigured()) return new LocalDataProvider(localStorage);
  const db = createClient();
  const { data } = await db.auth.getSession().catch(() => ({ data: { session: null } }));
  if (data.session?.user) return cloudProvider(db, data.session.user.id);
  // Offline with an expired access token: keep showing that account's own cached copy (read-only).
  const last = activeUser();
  if (!navigator.onLine && last && UUID.test(last) && localStorage.getItem("zest-cloud-" + last))
    return cloudProvider(db, last);
  return new LocalDataProvider(localStorage);
}

export type AccountCheck = "guest" | "ok" | "offline" | "signed-out" | "paused";
/** Confirms the session with the auth server and that cloud storage is enabled. */
export async function verifyAccount(provider: DataProvider): Promise<AccountCheck> {
  if (provider.mode !== "cloud") return "guest";
  if (!navigator.onLine) return "offline";
  const db = createClient();
  const { data, error } = await db.auth.getUser();
  if (!data.user) return error && !/session|jwt|auth/i.test(error.name + error.message) ? "offline" : "signed-out";
  try {
    const flags = await provider.loadFeatureFlags();
    if (!flags.cloud_persistence) return "paused";
  } catch {
    return "offline";
  }
  return "ok";
}

export function hasGuestData() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (raw?.scans?.length || raw?.events?.length) return true;
    if (PlannerStore.guestItems().length) return true;
    return JSON.parse(localStorage.getItem("zest-reminders-v1") || "[]").length > 0;
  } catch {
    return false;
  }
}

/**
 * Moves this device's guest scans, agenda, Planner and reminders into the signed-in account exactly
 * once, then clears the guest copies so they can never be merged into a different account later.
 * Local credits are never transferred: cloud balances come only from the server ledger.
 */
export async function migrateGuestData(provider: DataProvider) {
  if (provider.mode !== "cloud") throw new Error("Sign in to merge local data.");
  const local = await new LocalDataProvider(localStorage).load();
  if (local.scans.length || local.events.length) {
    const remote = await provider.load();
    await provider.save(mergeLocal(local, remote), remote);
  }
  const planner = await PlannerStore.create();
  const moved = planner.mode === "cloud" ? await planner.migrateGuest() : new Map<string, string>();
  await migrateGuestReminders(moved);
  localStorage.removeItem(STORAGE_KEY);
  return provider.load();
}

export function mergeLocal(local: LocalState, remote: LocalState): LocalState {
  const scans = new Map(remote.scans.map((s) => [s.id, s]));
  for (const s of local.scans) if (!scans.has(s.id)) scans.set(s.id, s);
  const events = new Map(remote.events.map((e) => [eventFingerprint(e), e]));
  for (const e of local.events)
    if (!events.has(eventFingerprint(e))) events.set(eventFingerprint(e), e);
  // Local rewards are retained as progress, never accepted as spendable cloud credits.
  return {
    ...remote,
    scans: [...scans.values()],
    events: [...events.values()],
  };
}
/** @deprecated kept for older callers; use migrateGuestData. */
export const migrateLocal = migrateGuestData;
export class Repository {
  constructor(public provider: DataProvider) {}
  async change(fn: (s: LocalState) => LocalState) {
    const before = await this.provider.load();
    const next = fn(before);
    await this.provider.save(next, before);
    return next;
  }
  loadProfile = () => this.provider.loadProfile();
  updateProfile = (p: Parameters<DataProvider["updateProfile"]>[0]) =>
    this.provider.updateProfile(p);
  createScan = (scan: LocalState["scans"][number]) =>
    this.change((s) => ({ ...s, scans: [scan, ...s.scans] }));
  completeScan = (id: string, patch: Partial<LocalState["scans"][number]>) =>
    this.change((s) => ({
      ...s,
      scans: s.scans.map((x) =>
        x.id === id ? { ...x, ...patch, status: "completed" } : x,
      ),
    }));
  failScan = (id: string) =>
    this.change((s) => ({
      ...s,
      scans: s.scans.map((x) => (x.id === id ? { ...x, status: "failed" } : x)),
    }));
  listScans = async () => (await this.provider.load()).scans;
  getScan = async (id: string) =>
    (await this.listScans()).find((s) => s.id === id);
  createEvents = (events: LocalState["events"]) =>
    this.change((s) => ({
      ...s,
      events: mergeLocal({ ...emptyState, events }, s).events,
    }));
  updateEvent = (id: string, patch: Partial<LocalState["events"][number]>) =>
    this.change((s) => ({
      ...s,
      events: s.events.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }));
  deleteEvent = (id: string) =>
    this.change((s) => ({ ...s, events: s.events.filter((e) => e.id !== id) }));
  listAgendaEvents = async () => (await this.provider.load()).events;
  markEventExported = (id: string) =>
    this.updateEvent(id, { exportedAt: new Date().toISOString() });
  checkDuplicateEvent = async (e: LocalState["events"][number]) =>
    (await this.listAgendaEvents()).some(
      (x) => eventFingerprint(x) === eventFingerprint(e),
    );
  loadUsage = () => this.provider.loadUsage();
  loadRewardLedger = () => this.provider.loadRewardLedger();
  loadRewardBalance = async () =>
    (await this.loadRewardLedger()).reduce((n, r) => n + r.amount, 0);
  loadFeatureFlags = () => this.provider.loadFeatureFlags();
  loadSubscription = () => this.provider.loadSubscription();
  createReferral = () => this.provider.createReferral();
  loadReferralStatus = () => this.provider.loadReferralStatus();
  loadCalendarConnections = () => this.provider.loadCalendarConnections();
}
