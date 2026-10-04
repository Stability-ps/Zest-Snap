import { createClient } from "@supabase/supabase-js";
import { plans as fallbackPlans, type PlanId } from "./product-config";
import { getSupabasePublicConfig, isSupabaseConfigured } from "./supabase/config";

export type CatalogPlan = {
  id: PlanId;
  name: string;
  description: string;
  monthlyPrice: number;
  annualPrice: number | null;
  currency: string;
  monthlyScans: number;
  pdfPagesPerScan: number;
  smartReminders: boolean;
  bulkExtraction: boolean;
  priorityProcessing: boolean;
  rewardsMultiplier: number;
  calendarIntegrations: boolean;
  recommended: boolean;
  active: boolean;
  displayOrder: number;
};

/** Safe defaults only — used when the database catalog is unavailable. */
export function fallbackCatalog(): CatalogPlan[] {
  return (Object.values(fallbackPlans) as (typeof fallbackPlans)[PlanId][]).map((p, i) => ({
    id: p.id,
    name: p.name,
    description: "",
    monthlyPrice: p.monthlyUsd,
    annualPrice: null,
    currency: "USD",
    monthlyScans: p.monthlyScans,
    pdfPagesPerScan: p.pdfPagesPerScan,
    smartReminders: p.smartReminders,
    bulkExtraction: p.bulkExtraction,
    priorityProcessing: p.priorityProcessing,
    rewardsMultiplier: p.rewardsMultiplier,
    calendarIntegrations: true,
    recommended: p.id === "plus",
    active: p.id === "free",
    displayOrder: i + 1,
  }));
}

export function catalogFromRows(rows: Record<string, any>[]): CatalogPlan[] {
  return rows
    .filter((r) => r && typeof r.id === "string" && typeof r.name === "string")
    .map((r) => ({
      id: r.id as PlanId,
      name: r.name,
      description: r.description || "",
      monthlyPrice: Number(r.monthly_price) || 0,
      annualPrice: r.annual_price === null || r.annual_price === undefined ? null : Number(r.annual_price),
      currency: r.currency || "USD",
      monthlyScans: Number(r.monthly_scans) || 0,
      pdfPagesPerScan: Number(r.pdf_pages) || 1,
      smartReminders: !!r.smart_reminders,
      bulkExtraction: !!r.bulk_extraction,
      priorityProcessing: !!r.priority_processing,
      rewardsMultiplier: Number(r.rewards_multiplier) || 1,
      calendarIntegrations: r.calendar_integrations !== false,
      recommended: !!r.recommended,
      active: !!r.active,
      displayOrder: Number(r.display_order) || 0,
    }))
    .sort((a, b) => a.displayOrder - b.displayOrder);
}

/**
 * Public pricing from the same plan_rules rows that enforce scan allowances, so the website,
 * the app and usage limits can never disagree. Falls back to code defaults if the database is unreachable.
 */
export async function getPublicPlanCatalog(): Promise<CatalogPlan[]> {
  if (!isSupabaseConfigured()) return fallbackCatalog();
  try {
    const { url, key } = getSupabasePublicConfig();
    // Read-only public pricing: an isolated anonymous client that never touches the signed-in session.
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "zest-public-catalog" } });
    const { data, error } = await db
      .from("plan_rules")
      .select("id,name,description,monthly_price,annual_price,currency,monthly_scans,pdf_pages,smart_reminders,bulk_extraction,priority_processing,rewards_multiplier,calendar_integrations,recommended,active,display_order,is_public")
      .eq("is_public", true);
    if (error || !data?.length) return fallbackCatalog();
    const catalog = catalogFromRows(data);
    return catalog.length ? catalog : fallbackCatalog();
  } catch {
    return fallbackCatalog();
  }
}

export function formatPlanPrice(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: amount % 1 ? 2 : 0 }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}
