export type FlagGroup = "AI" | "Calendar" | "Rewards" | "Growth" | "Plans" | "Platform" | "Experimental";

export type FlagMeta = {
  label: string;
  group: FlagGroup;
  description: string;
  /** Changes that affect every user or spend money require explicit confirmation. */
  highImpact?: boolean;
  /** Mirrors the database: only Owners may change these. */
  ownerOnly?: boolean;
};

export const flagMeta: Record<string, FlagMeta> = {
  ai_scanning: { label: "AI scanning", group: "AI", highImpact: true, ownerOnly: true,
    description: "Master switch for AI extraction. Turning it off stops every scan immediately." },
  guest_trial: { label: "Guest trial", group: "Growth", highImpact: true,
    description: "Lets signed-out visitors try a small, device-limited number of AI scans." },
  referrals: { label: "Referrals", group: "Growth",
    description: "Referral programme: invite links and qualified-referral rewards." },
  rewards: { label: "Zest Credits & rewards", group: "Rewards", highImpact: true,
    description: "Milestone, feedback and referral credits. Off stops new credits being issued." },
  direct_google_calendar: { label: "Google Calendar sync", group: "Calendar",
    description: "Direct Google Calendar connection (OAuth) for one-tap adding." },
  direct_outlook_calendar: { label: "Outlook Calendar sync", group: "Calendar",
    description: "Direct Outlook Calendar connection. Not yet implemented in the app." },
  business_plan: { label: "Business plan", group: "Plans", highImpact: true,
    description: "Business subscription availability." },
  cloud_persistence: { label: "Cloud persistence", group: "Platform", highImpact: true, ownerOnly: true,
    description: "Syncs signed-in users' data to the cloud. Turning it off affects every account." },
  push_notifications: { label: "Push notifications", group: "Platform", highImpact: true,
    description: "Reminder push delivery to installed devices." },
};

export const flagGroups: FlagGroup[] = ["AI", "Calendar", "Rewards", "Growth", "Plans", "Platform", "Experimental"];

export function metaFor(key: string, description?: string | null): FlagMeta {
  return flagMeta[key] || { label: key.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase()), group: "Experimental", description: description || "" };
}
