import { createClient, isSupabaseConfigured } from "../supabase/client";
import { LocalDataProvider } from "./local";
import { CachedCloudProvider } from "./cached";
import { SupabaseDataProvider } from "./cloud";
import { emptyState, type DataProvider, type LocalState } from "./types";
import { eventFingerprint } from "../events";
export * from "./types";
export { LocalDataProvider } from "./local";
export async function getDataProvider(): Promise<DataProvider> {
  if (!isSupabaseConfigured()) return new LocalDataProvider(localStorage);
  const db = createClient();
  // Browser-only cached identity is used exclusively to read that device's offline cache.
  if (!navigator.onLine) {
    const { data } = await db.auth.getSession();
    if (data.session?.user)
      return new CachedCloudProvider(
        new SupabaseDataProvider(db, data.session.user.id),
        "zest-cloud-" + data.session.user.id,
        localStorage,
      );
    return new LocalDataProvider(localStorage);
  }
  const { data, error } = await db.auth.getUser();
  if (error && error.name !== "AuthSessionMissingError")
    throw new Error(
      "Account connection unavailable. Reconnect to access your cloud data.",
    );
  if (!data.user) return new LocalDataProvider(localStorage);
  const referral = sessionStorage.getItem("zest-referral");
  if (referral) {
    const { error: claimError } = await db.rpc("claim_referral", {
      p_code: referral,
    });
    if (!claimError) sessionStorage.removeItem("zest-referral");
  }
  const cloud = new SupabaseDataProvider(db, data.user.id);
  const flags = await cloud.loadFeatureFlags();
  if (!flags.cloud_persistence)
    throw new Error(
      "Cloud persistence is temporarily paused. Your data is safe.",
    );
  return new CachedCloudProvider(
    cloud,
    "zest-cloud-" + data.user.id,
    localStorage,
  );
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
export async function migrateLocal(provider: DataProvider) {
  if (provider.mode !== "cloud")
    throw new Error("Sign in to merge local data.");
  const local = await new LocalDataProvider(localStorage).load();
  const remote = await provider.load();
  await provider.save(mergeLocal(local, remote), remote);
  const profile = await provider.loadProfile();
  await provider.updateProfile({
    ...profile,
    importedMilestones: {
      firstScan: Boolean(
        profile.importedMilestones?.firstScan || local.firstScanRewarded,
      ),
      firstCalendar: Boolean(
        profile.importedMilestones?.firstCalendar ||
        local.firstCalendarRewarded,
      ),
    },
  });
  // Keep original data for rollback; repeated merges use stable IDs and fingerprints.
  return provider.load();
}
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
