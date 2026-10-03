import {
  defaultProfile,
  emptyState,
  type DataProvider,
  type LocalState,
  type Profile,
} from "./types";
export const STORAGE_KEY = "zest-snap-local-v2";
export const localFlags = {
  ai_scanning: true,
  rewards: true,
  referrals: false,
  direct_google_calendar: false,
  direct_outlook_calendar: false,
  push_notifications: false,
  cloud_persistence: false,
  business_plan: false,
};
export class LocalDataProvider implements DataProvider {
  mode = "local" as const;
  constructor(
    private storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  ) {}
  async load(): Promise<LocalState> {
    const raw = this.storage.getItem(STORAGE_KEY);
    if (!raw) return { ...emptyState };
    const data = JSON.parse(raw);
    if (!Array.isArray(data.scans) || !Array.isArray(data.events))
      throw new Error(
        "Saved data could not be read. Export it in Settings before clearing storage.",
      );
    return { ...emptyState, ...data };
  }
  async save(next: LocalState) {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  async loadProfile(): Promise<Profile> {
    return {
      ...defaultProfile,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...JSON.parse(this.storage.getItem("zest-preferences") || "{}"),
    };
  }
  async updateProfile(p: Profile) {
    this.storage.setItem("zest-preferences", JSON.stringify(p));
  }
  async loadUsage() {
    return {
      period: new Date().toISOString().slice(0, 7),
      scans: (await this.load()).scans.filter((s) =>
        s.scannedAt.startsWith(new Date().toISOString().slice(0, 7)),
      ).length,
      allowance: 10,
    };
  }
  async loadRewardLedger() {
    const s = await this.load();
    return [
      ...(s.firstScanRewarded
        ? [
            {
              id: "first_scan",
              amount: 3,
              reason: "First scan",
              createdAt: s.scans.at(-1)?.scannedAt || "",
            },
          ]
        : []),
      ...(s.firstCalendarRewarded
        ? [
            {
              id: "first_calendar",
              amount: 5,
              reason: "First calendar file",
              createdAt: s.events[0]?.addedAt || "",
            },
          ]
        : []),
    ];
  }
  async loadFeatureFlags() {
    return localFlags;
  }
  async loadSubscription() {
    return { plan: "free" as const, status: "Billing not active" };
  }
  async createReferral(): Promise<string> {
    throw new Error("Referral rewards are not active.");
  }
  async loadReferralStatus() {
    return [];
  }
  async loadCalendarConnections() {
    return [];
  }
  async exportData() {
    return {
      data: await this.load(),
      profile: await this.loadProfile(),
      ledger: await this.loadRewardLedger(),
    };
  }
  async deleteData() {
    this.storage.removeItem(STORAGE_KEY);
    this.storage.removeItem("zest-preferences");
  }
}
