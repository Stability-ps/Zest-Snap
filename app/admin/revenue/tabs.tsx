import { Tabs } from "../_components/ui";
import { rangeQuery, type DateRange } from "@/lib/admin/range";

export function RevenueTabs({ current, range }: { current: string; range: DateRange }) {
  const q = rangeQuery(range);
  const s = q ? `?${q}` : "";
  return <Tabs current={current} tabs={[
    { key: "overview", label: "Revenue overview", href: `/admin/revenue${s}` },
    { key: "transactions", label: "Transactions", href: `/admin/revenue/transactions${s}` },
    { key: "subscriptions", label: "Subscriptions", href: `/admin/revenue/subscriptions${s}` },
  ]} />;
}

export function NotConnected() {
  return (
    <div className="zadm-card">
      <div className="zadm-empty">
        <div className="zadm-empty-icon" aria-hidden>$</div>
        <h3>Payment data not connected</h3>
        <p>
          No payment provider is sending transactions to Zest Snap yet, so there is no revenue, MRR, renewals, refunds or churn to report — and none is estimated.
          When billing goes live, the provider&apos;s webhook writes to the <span className="zadm-mono">payment_transactions</span> and <span className="zadm-mono">subscriptions</span> tables
          (server-side only) and this section fills in automatically.
        </p>
      </div>
    </div>
  );
}
