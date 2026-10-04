import type { SupabaseClient } from "@supabase/supabase-js";
import { eventFingerprint } from "../events";
import {
  defaultProfile,
  type DataProvider,
  type LocalState,
  type Profile,
  type StoredScan,
  type StoredEvent,
} from "./types";
import { localFlags } from "./local";
export class SupabaseDataProvider implements DataProvider {
  mode = "cloud" as const;
  constructor(
    private db: SupabaseClient,
    readonly userId: string,
  ) {}
  private check(error: unknown) {
    if (error)
      throw new Error("Cloud changes could not be saved. Reconnect and retry.");
  }
  private async payloads<T>(table: "scans" | "events"): Promise<T[]> {
    const rows: T[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await this.db
        .from(table)
        .select("payload")
        .eq("user_id", this.userId)
        .order("id")
        .range(offset, offset + 499);
      this.check(error);
      rows.push(...(data || []).map((r) => r.payload as T));
      if (!data || data.length < 500) return rows;
    }
  }
  async load(): Promise<LocalState> {
    const [scans, events, r] = await Promise.all([
      this.payloads<StoredScan>("scans"),
      this.payloads<StoredEvent>("events"),
      this.loadRewardLedger(),
    ]);
    return {
      scans: scans.sort((a, b) => b.scannedAt.localeCompare(a.scannedAt)),
      events,
      credits: r.reduce((n, x) => n + x.amount, 0),
      firstScanRewarded: r.some((x) => x.reason === "first_scan"),
      firstCalendarRewarded: r.some((x) => x.reason === "first_calendar"),
      earned: [...new Set(r.map((x) => x.reason))],
    };
  }
  async save(next: LocalState, previous: LocalState) {
    // Changed rows only: never overwrite an unseen remote record with a stale snapshot.
    for (const s of next.scans.filter(
      (s) =>
        JSON.stringify(s) !==
        JSON.stringify(previous.scans.find((p) => p.id === s.id)),
    )) {
      const { error } = await this.db.from("scans").upsert({
        id: s.id,
        user_id: this.userId,
        file_name: s.fileName,
        document_type: s.documentType,
        summary: s.summary,
        status: s.status || "review",
        created_at: s.scannedAt,
        payload: s,
        warning_count: s.warnings?.length || 0,
      });
      this.check(error);
    }
    for (const e of next.events.filter(
      (e) =>
        JSON.stringify(e) !==
        JSON.stringify(previous.events.find((p) => p.id === e.id)),
    )) {
      if (previous.events.some((p) => p.id === e.id)) {
        const { error } = await this.db
          .from("events")
          .update({
            title: e.title,
            start_date: e.startDate,
            end_date: e.endDate || e.startDate,
            start_time: e.startTime || null,
            end_time: e.endTime || null,
            timezone: e.timezone,
            all_day: e.allDay,
            fingerprint: eventFingerprint(e),
            payload: e,
            exported_at: e.exportedAt || null,
          })
          .eq("id", e.id)
          .eq("user_id", this.userId);
        this.check(error);
        continue;
      }
      const { error } = await this.db.from("events").upsert(
        {
          id: e.id,
          user_id: this.userId,
          title: e.title,
          start_date: e.startDate,
          end_date: e.endDate || e.startDate,
          start_time: e.startTime || null,
          end_time: e.endTime || null,
          timezone: e.timezone,
          all_day: e.allDay,
          fingerprint: eventFingerprint(e),
          payload: e,
          exported_at: e.exportedAt || null,
        },
        { onConflict: "user_id,fingerprint", ignoreDuplicates: true },
      );
      this.check(error);
    }
    for (const id of previous.events
      .filter((e) => !next.events.some((n) => n.id === e.id))
      .map((e) => e.id)) {
      const { error } = await this.db
        .from("events")
        .delete()
        .eq("id", id)
        .eq("user_id", this.userId);
      this.check(error);
    }
    for (const id of previous.scans
      .filter((s) => !next.scans.some((n) => n.id === s.id))
      .map((s) => s.id)) {
      const { error } = await this.db
        .from("scans")
        .delete()
        .eq("id", id)
        .eq("user_id", this.userId);
      this.check(error);
    }
  }
  async loadProfile() {
    const { data, error } = await this.db
      .from("profiles")
      .select("display_name,timezone,locale,preferences")
      .eq("id", this.userId)
      .single();
    this.check(error);
    return {
      ...defaultProfile,
      ...data?.preferences,
      displayName: data?.display_name || "",
      timezone: data?.timezone || "UTC",
      locale: data?.locale || "en",
    } as Profile;
  }
  async updateProfile(p: Profile) {
    const { error } = await this.db
      .from("profiles")
      .update({
        display_name: p.displayName,
        timezone: p.timezone,
        locale: p.locale,
        preferences: {
          reminders: p.reminders,
          weeklyRecap: p.weeklyRecap,
          retentionDays: p.retentionDays,
          calendar: "ics",
          importedMilestones: p.importedMilestones || null,
        },
      })
      .eq("id", this.userId);
    this.check(error);
  }
  async loadUsage() {
    const period = new Date().toISOString().slice(0, 7);
    const sub = await this.loadSubscription();
    const [u, r] = await Promise.all([
      this.db
        .from("usage_monthly")
        .select("ai_scans,bonus_scans")
        .eq("user_id", this.userId)
        .eq("period_start", period + "-01")
        .maybeSingle(),
      this.db
        .from("plan_rules")
        .select("monthly_scans")
        .eq("id", sub.plan)
        .single(),
    ]);
    this.check(u.error || r.error);
    return {
      period,
      scans: u.data?.ai_scans || 0,
      allowance: (r.data?.monthly_scans || 0) + (u.data?.bonus_scans || 0),
    };
  }
  async loadRewardLedger() {
    const { data, error } = await this.db
      .from("reward_ledger")
      .select("id,amount,reason,created_at")
      .eq("user_id", this.userId);
    this.check(error);
    return (data || []).map((r) => ({
      id: r.id,
      amount: r.amount,
      reason: r.reason,
      createdAt: r.created_at,
    }));
  }
  async loadRewardRules() {
    const { data, error } = await this.db.from("reward_rules").select("key,amount,enabled");
    this.check(error);
    return Object.fromEntries((data || []).filter((r) => r.enabled).map((r) => [r.key, r.amount])) as Record<string, number>;
  }
  async loadFeatureFlags() {
    const { data, error } = await this.db
      .from("feature_flags")
      .select("key,enabled");
    this.check(error);
    return {
      ...localFlags,
      ...Object.fromEntries((data || []).map((x) => [x.key, x.enabled])),
    };
  }
  async loadSubscription() {
    const { data, error } = await this.db
      .from("profiles")
      .select("plan")
      .eq("id", this.userId)
      .single();
    this.check(error);
    return { plan: data?.plan || "free", status: "Billing not active" };
  }
  async createReferral() {
    const { data, error } = await this.db.rpc("create_referral");
    this.check(error);
    return String(data);
  }
  async loadReferralStatus() {
    const { data, error } = await this.db
      .from("referrals")
      .select("referral_code,status")
      .eq("referrer_id", this.userId);
    this.check(error);
    return data || [];
  }
  async loadCalendarConnections() {
    const { data, error } = await this.db
      .from("calendar_connections")
      .select("id,provider,connected_at")
      .eq("user_id", this.userId);
    this.check(error);
    return (data || []).map((c) => ({
      id: c.id,
      provider: c.provider,
      connectedAt: c.connected_at,
    }));
  }
  async exportData() {
    const rows = async (table: string, columns: string, owner = "user_id") => {
      const { data, error } = await this.db.from(table).select(columns).eq(owner, this.userId);
      this.check(error);
      return data || [];
    };
    const { data: auth } = await this.db.auth.getUser();
    return {
      exportedAt: new Date().toISOString(),
      account: { id: this.userId, email: auth.user?.email || null, createdAt: auth.user?.created_at || null },
      profile: await this.loadProfile(),
      scans: (await this.load()).scans,
      calendarExports: (await this.load()).events,
      planner: await rows("planner_items", "id,type,title,description,start_date,end_date,start_time,end_time,due_date,due_time,all_day,timezone,location,status,source,completed_at,created_at,updated_at"),
      reminders: await rows("reminders", "id,planner_item_id,scheduled_at,status,offset_minutes,label,delivered_at,snoozed_until,handled_at,created_at"),
      rewardLedger: await this.loadRewardLedger(),
      usage: await this.loadUsage(),
      referralsSent: await this.loadReferralStatus(),
      feedback: await rows("product_feedback", "rating,feedback,created_at"),
      calendarConnections: await this.loadCalendarConnections(),
    };
  }
  async deleteData() {
    const res = await fetch("/api/account", {
      method: "DELETE",
      headers: { "X-Zest-Action": "delete-account" },
    });
    if (!res.ok) throw new Error("Account deletion failed. Please retry.");
  }
}
