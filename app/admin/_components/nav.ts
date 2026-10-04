export type NavItem = { href: string; label: string; icon: string; badge?: "support" | "reports" | "feedback" };
export type NavGroup = { label: string | null; items: NavItem[] };

export const adminNav: NavGroup[] = [
  { label: null, items: [{ href: "/admin", label: "Overview", icon: "LayoutDashboard" }] },
  { label: "Analytics", items: [
    { href: "/admin/analytics", label: "Product Analytics", icon: "BarChart3" },
    { href: "/admin/analytics/growth", label: "User Growth", icon: "TrendingUp" },
    { href: "/admin/analytics/retention", label: "Retention", icon: "Repeat" },
  ] },
  { label: "Revenue", items: [
    { href: "/admin/revenue", label: "Revenue Overview", icon: "Wallet" },
    { href: "/admin/revenue/transactions", label: "Transactions", icon: "Receipt" },
    { href: "/admin/revenue/subscriptions", label: "Subscriptions", icon: "BadgeDollarSign" },
  ] },
  { label: "Users", items: [
    { href: "/admin/users", label: "All Users", icon: "Users" },
    { href: "/admin/activity", label: "Activity", icon: "Activity" },
    { href: "/admin/referrals", label: "Referrals", icon: "Share2" },
    { href: "/admin/rewards", label: "Rewards", icon: "Gift" },
  ] },
  { label: "Product", items: [
    { href: "/admin/scans", label: "Scans", icon: "ScanLine" },
    { href: "/admin/planner", label: "Planner & Tasks", icon: "ListChecks" },
    { href: "/admin/reminders", label: "Reminders", icon: "BellRing" },
    { href: "/admin/calendar", label: "Calendar", icon: "CalendarDays" },
    { href: "/admin/ai", label: "AI Usage", icon: "Sparkles" },
  ] },
  { label: "Customer", items: [
    { href: "/admin/support", label: "Support", icon: "LifeBuoy", badge: "support" },
    { href: "/admin/reports", label: "Reports", icon: "Bug", badge: "reports" },
    { href: "/admin/ratings", label: "Ratings & Reviews", icon: "Star" },
    { href: "/admin/feedback", label: "Feedback", icon: "MessageSquare", badge: "feedback" },
  ] },
  { label: "Configuration", items: [
    { href: "/admin/plans", label: "Plans & Pricing", icon: "Tags" },
    { href: "/admin/rewards/rules", label: "Reward Rules", icon: "Award" },
    { href: "/admin/flags", label: "Feature Flags", icon: "ToggleRight" },
    { href: "/admin/content", label: "Content", icon: "FileText" },
    { href: "/admin/notifications", label: "Notifications", icon: "Megaphone" },
  ] },
  { label: "Operations", items: [
    { href: "/admin/exports", label: "Exports", icon: "Download" },
    { href: "/admin/audit", label: "Audit Log", icon: "ScrollText" },
    { href: "/admin/health", label: "System Health", icon: "HeartPulse" },
  ] },
  { label: "Administration", items: [
    { href: "/admin/admins", label: "Admin Users", icon: "ShieldCheck" },
    { href: "/admin/settings", label: "Settings", icon: "Settings" },
  ] },
];

/** Most specific nav entry for a path, so /admin/users/123 highlights "All Users" and /admin/rewards/rules wins over /admin/rewards. */
export function activeHref(pathname: string) {
  const all = adminNav.flatMap((g) => g.items.map((i) => i.href));
  return all.filter((h) => pathname === h || (h !== "/admin" && pathname.startsWith(h + "/"))).sort((a, b) => b.length - a.length)[0] || "/admin";
}
