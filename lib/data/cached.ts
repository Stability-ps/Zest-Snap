import type { DataProvider, LocalState, Profile } from "./types";
export class CachedCloudProvider implements DataProvider {
  private flushing: Promise<void> | null = null;
  mode = "cloud" as const;
  constructor(
    private cloud: DataProvider,
    private key: string,
    private storage: Storage,
  ) {}
  private read() {
    const raw = this.storage.getItem(this.key);
    return raw
      ? (JSON.parse(raw) as {
          state: LocalState;
          profile?: Profile;
          pending?: { next: LocalState; previous: LocalState }[];
        })
      : null;
  }
  async flush() {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      while (true) {
        const op = this.read()?.pending?.[0];
        if (!op) break;
        await this.cloud.save(op.next, op.previous);
        const latest = this.read();
        this.storage.setItem(
          this.key,
          JSON.stringify({
            ...latest,
            pending: latest?.pending?.slice(1) || [],
          }),
        );
      }
    })();
    try {
      await this.flushing;
    } finally {
      this.flushing = null;
    }
  }
  async load() {
    const cache = this.read();
    if (!navigator.onLine) {
      if (!cache)
        throw new Error(
          "Open your cloud account online once to make it available offline.",
        );
      return cache.state;
    }
    await this.flush();
    const state = await this.cloud.load();
    this.storage.setItem(this.key, JSON.stringify({ ...this.read(), state }));
    return state;
  }
  async save(next: LocalState, previous: LocalState) {
    const cache = this.read();
    this.storage.setItem(
      this.key,
      JSON.stringify({
        ...cache,
        state: next,
        pending: [...(cache?.pending || []), { next, previous }],
      }),
    );
    if (navigator.onLine) await this.flush();
  }
  async loadProfile() {
    const cache = this.read();
    if (!navigator.onLine && cache?.profile) return cache.profile;
    const profile = await this.cloud.loadProfile();
    this.storage.setItem(this.key, JSON.stringify({ ...this.read(), profile }));
    return profile;
  }
  async updateProfile(profile: Profile) {
    if (!navigator.onLine)
      throw new Error("Reconnect to update account preferences.");
    await this.cloud.updateProfile(profile);
    this.storage.setItem(this.key, JSON.stringify({ ...this.read(), profile }));
  }
  loadUsage = () => this.cloud.loadUsage();
  loadRewardLedger = () => this.cloud.loadRewardLedger();
  loadFeatureFlags = () => this.cloud.loadFeatureFlags();
  loadSubscription = () => this.cloud.loadSubscription();
  createReferral = () => this.cloud.createReferral();
  loadReferralStatus = () => this.cloud.loadReferralStatus();
  loadCalendarConnections = () => this.cloud.loadCalendarConnections();
  exportData = () => this.cloud.exportData();
  async deleteData() {
    await this.cloud.deleteData();
    this.storage.removeItem(this.key);
  }
}
export function clearCloudCaches(storage: Storage) {
  for (let i = storage.length - 1; i >= 0; i--) {
    const key = storage.key(i);
    if (key?.startsWith("zest-cloud-")) storage.removeItem(key);
  }
}
