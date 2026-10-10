import { Briefcase, GraduationCap, PartyPopper, Plane, Receipt, Sparkles, Stethoscope } from "lucide-react";
import type { ItemCategory } from "@/lib/item-category";

const ICONS = {
  school: GraduationCap,
  health: Stethoscope,
  work: Briefcase,
  bills: Receipt,
  travel: Plane,
  social: PartyPopper,
  personal: Sparkles,
} satisfies Record<ItemCategory, typeof Sparkles>;

/** The icon for an item category (lib/item-category.ts); colour comes from the surrounding .cat-* class. */
export default function CategoryIcon({ category, size = 16 }: { category: ItemCategory; size?: number }) {
  const Icon = ICONS[category];
  return <Icon size={size} aria-hidden="true" />;
}
