// Dedicated project contract; regenerate with `supabase gen types typescript` after activation.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];
export type PlanCode = "free" | "plus" | "business";
export type ProfileRow = {
  id: string;
  display_name: string | null;
  locale: string;
  timezone: string;
  country_code: string | null;
  plan: PlanCode;
  onboarding_complete: boolean;
  is_admin: boolean;
  reward_balance: number;
  preferences: Json;
  created_at: string;
  updated_at: string;
};
export type ScanRow = {
  id: string;
  user_id: string;
  file_name: string | null;
  mime_type: string | null;
  source_object_path: string | null;
  document_type: string | null;
  summary: string | null;
  status: "processing" | "review" | "completed" | "failed";
  warning_count: number;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_usd: number | null;
  created_at: string;
  completed_at: string | null;
  payload: Json;
  imported: boolean;
};
export type EventRow = {
  id: string;
  user_id: string;
  scan_id: string | null;
  title: string;
  start_date: string | null;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  timezone: string | null;
  location: string | null;
  description: string | null;
  all_day: boolean;
  category: string | null;
  confidence: number | null;
  confidence_reason: string | null;
  source_text: string | null;
  reviewed: boolean;
  calendar_provider: "ics" | "google" | "apple" | "outlook" | null;
  calendar_external_id: string | null;
  exported_at: string | null;
  created_at: string;
  updated_at: string;
  payload: Json;
  fingerprint: string | null;
};
export type UsageRow = {
  user_id: string;
  period_start: string;
  ai_scans: number;
  pdf_pages: number;
  bonus_scans: number;
  estimated_cost_usd: number;
};
export type RewardRow = {
  id: string;
  user_id: string;
  entry_type: "earn" | "spend" | "adjustment" | "expiry";
  amount: number;
  reason: string;
  reference_type: string | null;
  reference_id: string | null;
  created_at: string;
};
export type ReferralRow = {
  id: string;
  referrer_id: string;
  referred_user_id: string | null;
  referral_code: string;
  status: "invited" | "signed_up" | "qualified" | "rewarded";
  created_at: string;
  qualified_at: string | null;
};
export type ConnectionRow = {
  id: string;
  user_id: string;
  provider: "ics" | "google" | "apple" | "outlook";
  provider_account: string | null;
  is_primary: boolean;
  connected_at: string;
  last_sync_at: string | null;
};
export type SubscriptionRow = {
  id: string;
  user_id: string;
  provider: string | null;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  plan: PlanCode;
  status: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  updated_at: string;
};
export type FlagRow = {
  key: string;
  description: string | null;
  enabled: boolean;
  public_visible: boolean;
  updated_at: string;
};
export type PlanRow = {
  id: PlanCode;
  monthly_scans: number;
  pdf_pages: number;
  credits_per_bonus_scan: number;
  active: boolean;
};
export type ReminderRow = {
  id: string;
  user_id: string;
  event_id: string | null;
  kind: "event" | "deadline" | "unexported" | "weekly";
  scheduled_at: string;
  status: "pending" | "sent" | "cancelled" | "failed";
  delivered_at: string | null;
  created_at: string;
};
export type PushRow = {
  id: string;
  user_id: string;
  endpoint: string;
  keys: Json;
  created_at: string;
};
export type ScanRequestRow = {
  id: string;
  user_id: string;
  created_at: string;
  status: string;
  content_hash: string;
};
type Table<T> = {
  Row: T;
  Insert: Partial<T>;
  Update: Partial<T>;
  Relationships: [];
};
export type Database = {
  public: {
    Tables: {
      profiles: Table<ProfileRow>;
      scans: Table<ScanRow>;
      events: Table<EventRow>;
      usage_monthly: Table<UsageRow>;
      reward_ledger: Table<RewardRow>;
      referrals: Table<ReferralRow>;
      calendar_connections: Table<ConnectionRow>;
      subscriptions: Table<SubscriptionRow>;
      feature_flags: Table<FlagRow>;
      plan_rules: Table<PlanRow>;
      reminders: Table<ReminderRow>;
      push_subscriptions: Table<PushRow>;
      scan_requests: Table<ScanRequestRow>;
      admin_content: Table<{ key: string; body: string; updated_at: string }>;
    };
    Views: Record<string, never>;
    Functions: {
      is_admin: { Args: Record<string, never>; Returns: boolean };
      reserve_scan: {
        Args: { p_user: string; p_request: string; p_hash: string };
        Returns: number;
      };
      award_milestone: {
        Args: { p_user: string; p_reason: string };
        Returns: undefined;
      };
      create_referral: { Args: Record<string, never>; Returns: string };
    };
    Enums: { plan_code: PlanCode };
    CompositeTypes: Record<string, never>;
  };
};
