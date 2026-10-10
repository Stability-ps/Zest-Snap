/**
 * A display category for Planner, Today and To-do items: drives the colour stripe and icon. Planner items don't store
 * a category, so it is inferred from the title (and description/location) with keyword rules, falling back to
 * "personal" (the person's accent colour). Purely visual: nothing is saved or sent anywhere.
 */
export type ItemCategory = "school" | "health" | "work" | "bills" | "travel" | "social" | "personal";

export const ITEM_CATEGORIES: readonly ItemCategory[] = ["school", "health", "work", "bills", "travel", "social", "personal"];

export const CATEGORY_LABEL: Record<ItemCategory, string> = {
  school: "School",
  health: "Health",
  work: "Work",
  bills: "Bills",
  travel: "Travel",
  social: "Social",
  personal: "Personal",
};

// Checked in order: the first matching rule wins. Word boundaries keep "pay" from matching "payroll meeting" etc.
const RULES: [ItemCategory, RegExp][] = [
  ["health", /\b(doctor|dr\.?|dentist|dental|clinic|hospital|gp|physio|therapy|therapist|optometrist|eye test|vaccin\w*|checkup|check-up|pharmacy|prescription|appointment card|medical|ortho\w*|pediatric\w*|paediatric\w*)\b/i],
  ["school", /\b(school|class(es)?|teacher|parent(s)?[ -]evening|pta|homework|exam(s)?|test week|term|semester|uniform|science fair|sports day|grade \d+|university|lecture|tutor\w*|assignment|report card|field trip|school trip|nursery|creche|kindergarten)\b/i],
  ["bills", /\b(pay|payment|bill|invoice|due amount|renew\w*|licen[cs]e|subscription|insurance|rent|levy|rates|tax|debit order|premium|instal?ment|account due|fees?)\b/i],
  ["travel", /\b(flight|fly|airport|check[- ]?in|boarding|train|bus|hotel|booking ref|reservation|trip|holiday|vacation|passport|visa|uber|airbnb)\b/i],
  ["work", /\b(meeting|standup|stand-up|call with|client|interview|deadline|presentation|review|project|report|conference|workshop|sync|1:1|one-on-one|office)\b/i],
  ["social", /\b(birthday|party|wedding|dinner|lunch|braai|concert|show|match|game|festival|invite|invitation|celebration|anniversary|movie|cinema|tickets?)\b/i],
];

export function itemCategory(item: { title?: string; description?: string; location?: string }): ItemCategory {
  const text = `${item.title ?? ""} ${item.location ?? ""} ${item.description ?? ""}`;
  for (const [category, pattern] of RULES) if (pattern.test(text)) return category;
  return "personal";
}
