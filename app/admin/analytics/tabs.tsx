import { Tabs } from "../_components/ui";
import { rangeQuery, type DateRange } from "@/lib/admin/range";

export function AnalyticsTabs({ current, range }: { current: string; range: DateRange }) {
  const q = rangeQuery(range);
  const s = q ? `?${q}` : "";
  return <Tabs current={current} tabs={[
    { key: "product", label: "Product analytics", href: `/admin/analytics${s}` },
    { key: "growth", label: "User growth", href: `/admin/analytics/growth${s}` },
    { key: "retention", label: "Retention", href: `/admin/analytics/retention${s}` },
    { key: "conversion", label: "Conversion", href: `/admin/analytics/conversion${s}` },
  ]} />;
}
