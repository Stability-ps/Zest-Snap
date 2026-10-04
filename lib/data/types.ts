import type { ExtractedEvent } from "../extraction-types";
export type StoredScan = {
  id: string;
  fileName: string;
  scannedAt: string;
  documentType: string;
  summary: string;
  events: ExtractedEvent[];
  warnings?: string[];
  status?: "processing" | "review" | "completed" | "failed";
};
export type StoredEvent = ExtractedEvent & {
  id: string;
  addedAt: string;
  exportedAt?: string;
};
export type Profile = {
  displayName: string;
  timezone: string;
  locale: string;
  reminders: boolean;
  weeklyRecap: boolean;
  calendar: "ics";
  retentionDays: number;
  importedMilestones?: { firstScan: boolean; firstCalendar: boolean };
};
export type RewardEntry = {
  id: string;
  amount: number;
  reason: string;
  createdAt: string;
};
export type Usage = { period: string; scans: number; allowance: number };
export type Subscription = {
  plan: "free" | "plus" | "business";
  status: string;
};
export type CalendarConnection = {
  id: string;
  provider: string;
  connectedAt: string;
};
export type Referral = { referral_code: string; status: string };
export type Reminder = {
  id: string;
  kind: "event" | "deadline" | "unexported" | "weekly";
  scheduledAt: string;
  status: "pending" | "sent" | "cancelled" | "failed";
};
export type LocalState = {
  scans: StoredScan[];
  events: StoredEvent[];
  credits: number;
  firstScanRewarded: boolean;
  firstCalendarRewarded: boolean;
  /** Reward reasons already in the server ledger (cloud accounts only). */
  earned?: string[];
};
export const emptyState: LocalState = {
  scans: [],
  events: [],
  credits: 0,
  firstScanRewarded: false,
  firstCalendarRewarded: false,
};
export const defaultProfile: Profile = {
  displayName: "",
  timezone: "UTC",
  locale: "en",
  reminders: true,
  weeklyRecap: false,
  calendar: "ics",
  retentionDays: 90,
};
export interface DataProvider {
  mode: "local" | "cloud";
  /** Set for signed-in (cloud) providers. */
  readonly userId?: string;
  loadCached?(): LocalState | null;
  loadCachedProfile?(): Profile | null;
  load(): Promise<LocalState>;
  save(next: LocalState, previous: LocalState): Promise<void>;
  loadProfile(): Promise<Profile>;
  updateProfile(profile: Profile): Promise<void>;
  loadUsage(): Promise<Usage>;
  loadRewardLedger(): Promise<RewardEntry[]>;
  loadFeatureFlags(): Promise<Record<string, boolean>>;
  loadSubscription(): Promise<Subscription>;
  createReferral(): Promise<string>;
  loadReferralStatus(): Promise<Referral[]>;
  loadRewardRules?(): Promise<Record<string, number>>;
  loadCalendarConnections(): Promise<CalendarConnection[]>;
  exportData(): Promise<unknown>;
  deleteData(): Promise<void>;
}
