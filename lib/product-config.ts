export type PlanId = "free" | "plus" | "business";

export const plans = {
  free: {
    id: "free" as const,
    name: "Free",
    monthlyUsd: 0,
    monthlyScans: 10,
    pdfPagesPerScan: 3,
    smartReminders: false,
    bulkExtraction: false,
    priorityProcessing: false,
    rewardsMultiplier: 1,
  },
  plus: {
    id: "plus" as const,
    name: "Zest Snap+",
    monthlyUsd: 4.99,
    monthlyScans: 100,
    pdfPagesPerScan: 20,
    smartReminders: true,
    bulkExtraction: true,
    priorityProcessing: true,
    rewardsMultiplier: 1.25,
  },
  business: {
    id: "business" as const,
    name: "Business",
    monthlyUsd: 11.99,
    monthlyScans: 350,
    pdfPagesPerScan: 50,
    smartReminders: true,
    bulkExtraction: true,
    priorityProcessing: true,
    rewardsMultiplier: 1.5,
  },
};

export const rewardRules = {
  firstSuccessfulScan: 3,
  connectCalendar: 5,
  referralSenderBonusScans: 10,
  referralRecipientBonusScans: 10,
  tenEventsSaved: 5,
  weeklyRecapViewed: 1,
};

export const productConfig = {
  primaryDomain: "zestsnap.app",
  regionalDomains: ["zestsnap.co.za", "zest-snap.co.za"],
  contactEmail: "hello@zestsnap.app",
  supportEmail: "support@zestsnap.app",
  privacyEmail: "privacy@zestsnap.app",
  tagline: "Anything with a date becomes actionable.",
};
