"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity, Award, BadgeDollarSign, BarChart3, Bell, BellRing, Bug, CalendarDays, ChevronsLeft, ChevronsRight, Download, ExternalLink,
  FileText, Gift, Globe, HeartPulse, LayoutDashboard, LifeBuoy, ListChecks, LogOut, Megaphone, Menu, MessageSquare, Receipt, Repeat,
  ScanLine, ScrollText, Search, Settings, Share2, ShieldCheck, Sparkles, Star, Tags, ToggleRight, TrendingUp, Users, Wallet, X,
  type LucideIcon,
} from "lucide-react";
import { adminNav, activeHref } from "./nav";
import { rangeOptions } from "@/lib/admin/range";
import { signOut } from "@/lib/session";

const icons: Record<string, LucideIcon> = {
  Activity, Award, BadgeDollarSign, BarChart3, BellRing, Bug, CalendarDays, Download, FileText, Gift, HeartPulse, LayoutDashboard, LifeBuoy,
  ListChecks, Megaphone, MessageSquare, Receipt, Repeat, ScanLine, ScrollText, Settings, Share2, ShieldCheck, Sparkles, Star, Tags,
  ToggleRight, TrendingUp, Users, Wallet,
};

export type Attention = Partial<Record<
  "tickets_new" | "tickets_urgent" | "tickets_open" | "reports_new" | "feedback_new" | "low_ratings_7d" | "failed_scans_24h" |
  "stuck_scans" | "reminders_failed_24h" | "reminders_overdue" | "push_failing" | "flagged_users", number>>;

function useOutside<T extends HTMLElement>(open: boolean, close: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

/** Pages that are not date-scoped hide the range picker so it never implies a filter that isn't applied. */
const RANGED = ["/admin", "/admin/analytics", "/admin/revenue", "/admin/activity", "/admin/referrals", "/admin/rewards", "/admin/scans",
  "/admin/planner", "/admin/reminders", "/admin/calendar", "/admin/ai", "/admin/ratings", "/admin/feedback", "/admin/exports", "/admin/audit"];

function RangePicker() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get("range") || "30d";
  const [from, setFrom] = useState(params.get("from") || "");
  const [to, setTo] = useState(params.get("to") || "");
  const ranged = RANGED.some((p) => pathname === p || (p !== "/admin" && pathname.startsWith(p + "/")));
  if (!ranged || pathname.startsWith("/admin/users/") || pathname === "/admin/rewards/rules") return null;
  const go = (next: URLSearchParams) => {
    next.delete("page");
    router.push(`${pathname}?${next.toString()}`);
  };
  return (
    <div className="ad-range">
      <label className="ad-hide-sm" htmlFor="ad-range" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Date range</label>
      <select id="ad-range" className="ad-select" value={current} onChange={(e) => {
        const next = new URLSearchParams(params.toString());
        if (e.target.value === "30d") next.delete("range"); else next.set("range", e.target.value);
        if (e.target.value !== "custom") { next.delete("from"); next.delete("to"); go(next); } else {
          const today = new Date().toISOString().slice(0, 10);
          const start = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
          setFrom(start); setTo(today); next.set("from", start); next.set("to", today); go(next);
        }
      }}>
        {rangeOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
      {current === "custom" && (
        <form className="ad-range-custom" onSubmit={(e) => {
          e.preventDefault();
          const next = new URLSearchParams(params.toString());
          next.set("range", "custom"); next.set("from", from); next.set("to", to); go(next);
        }}>
          <input className="ad-input" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From" required />
          <input className="ad-input" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To" required />
          <button className="ad-btn">Apply</button>
        </form>
      )}
    </div>
  );
}

function Alerts({ attention }: { attention: Attention | null }) {
  const [open, setOpen] = useState(false);
  const ref = useOutside<HTMLDivElement>(open, () => setOpen(false));
  const items = attention ? [
    { n: attention.tickets_urgent, label: "urgent or high-priority tickets", href: "/admin/support?priority=urgent" },
    { n: attention.tickets_new, label: "new support tickets", href: "/admin/support?status=new" },
    { n: attention.reports_new, label: "new problem reports", href: "/admin/reports?status=new" },
    { n: attention.low_ratings_7d, label: "low ratings this week", href: "/admin/ratings?rating=1" },
    { n: attention.failed_scans_24h, label: "failed scans in 24h", href: "/admin/scans?status=failed&range=today" },
    { n: attention.stuck_scans, label: "scans stuck processing", href: "/admin/health" },
    { n: attention.reminders_failed_24h, label: "reminder deliveries failed (24h)", href: "/admin/reminders" },
    { n: attention.reminders_overdue, label: "reminders overdue for delivery", href: "/admin/health" },
    { n: attention.feedback_new, label: "unreviewed feedback", href: "/admin/feedback?status=new" },
  ].filter((i) => Number(i.n) > 0) : [];
  const total = items.reduce((a, i) => a + Number(i.n), 0);
  return (
    <div className="ad-pop" ref={ref}>
      <button className="ad-btn ad-icon-btn" aria-label={`Alerts${total ? `, ${total} need attention` : ""}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Bell aria-hidden />
        {total > 0 && <span className="ad-dot">{total > 99 ? "99+" : total}</span>}
      </button>
      {open && (
        <div className="ad-pop-panel">
          <header>Needs attention</header>
          <div className="ad-menu">
            {attention === null && <p style={{ padding: "12px 14px", margin: 0, color: "var(--ad-muted)" }}>Alerts are unavailable until the admin database upgrade is applied.</p>}
            {attention && !items.length && <p style={{ padding: "12px 14px", margin: 0, color: "var(--ad-muted)" }}>All clear — nothing needs attention.</p>}
            {items.map((i) => (
              <Link key={i.label} href={i.href} prefetch={false} onClick={() => setOpen(false)}>
                <b style={{ minWidth: 26 }}>{i.n}</b><span>{i.label}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileMenu({ name, email, role }: { name: string | null; email: string | null; role: string }) {
  const [open, setOpen] = useState(false);
  const ref = useOutside<HTMLDivElement>(open, () => setOpen(false));
  const initial = (name || email || "A").trim().charAt(0).toUpperCase();
  return (
    <div className="ad-pop" ref={ref}>
      <button className="ad-btn ad-icon-btn" style={{ borderRadius: 99, background: "var(--ad-navy)", color: "#fff", borderColor: "var(--ad-navy)", fontWeight: 800 }}
        aria-label="Account menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{initial}</button>
      {open && (
        <div className="ad-pop-panel" style={{ width: 260 }}>
          <header style={{ display: "grid", gap: 2 }}>
            <span>{name || "Admin"}</span>
            <small style={{ color: "var(--ad-muted)", fontWeight: 500 }}>{email}</small>
            <small style={{ color: "var(--ad-teal-ink)", fontWeight: 700, textTransform: "capitalize" }}>{role}</small>
          </header>
          <div className="ad-menu">
            <a href="/app"><ExternalLink aria-hidden /> Open Zest Snap</a>
            <a href="https://zestsnap.app" target="_blank" rel="noreferrer"><Globe aria-hidden /> View public site</a>
            <button onClick={async () => {
              await signOut().catch(() => undefined);
              window.location.assign(new URL("/login?next=%2Fadmin", window.location.origin).href);
            }}><LogOut aria-hidden /> Sign out</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminShell({ children, admin, attention, buildLabel }: {
  children: ReactNode;
  admin: { name: string | null; email: string | null; role: string };
  attention: Attention | null;
  buildLabel: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const active = activeHref(pathname);

  useEffect(() => {
    try { setCollapsed(localStorage.getItem("zest-admin-collapsed") === "1"); } catch {}
  }, []);
  useEffect(() => setDrawer(false), [pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !/input|textarea|select/i.test(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const counts: Record<string, number | undefined> = {
    support: attention?.tickets_open, reports: attention?.reports_new, feedback: attention?.feedback_new,
  };

  return (
    <div className="ad-root" data-collapsed={collapsed} data-drawer={drawer ? "open" : "closed"}>
      <aside className="ad-side" aria-label="Admin navigation">
        <div className="ad-side-head">
          <Link href="/admin" prefetch={false} className="ad-logo">
            <span className="ad-logo-mark" aria-hidden>Z</span>
            <span className="ad-hide-collapsed">Zest Snap<small>Admin</small></span>
          </Link>
          <button className="ad-collapse-btn desktop" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => {
            setCollapsed((c) => {
              try { localStorage.setItem("zest-admin-collapsed", c ? "0" : "1"); } catch {}
              return !c;
            });
          }}>{collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}</button>
          {drawer && <button className="ad-collapse-btn" aria-label="Close menu" onClick={() => setDrawer(false)}><X size={18} /></button>}
        </div>
        <nav>
          {adminNav.map((group, gi) => (
            <div key={gi} style={{ display: "contents" }}>
              {group.label && <div className="ad-nav-group">{group.label}</div>}
              {group.items.map((item) => {
                const Icon = icons[item.icon] || LayoutDashboard;
                const count = item.badge ? counts[item.badge] : undefined;
                return (
                  <Link key={item.href} href={item.href} prefetch={false} className="ad-nav-link" aria-current={active === item.href ? "page" : undefined} title={collapsed ? item.label : undefined}>
                    <Icon aria-hidden />
                    <span className="ad-hide-collapsed">{item.label}</span>
                    {!!count && <span className="ad-nav-count ad-hide-collapsed">{count}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="ad-side-foot ad-hide-collapsed">Build {buildLabel}</div>
      </aside>
      {drawer && <div className="ad-drawer-backdrop" onClick={() => setDrawer(false)} aria-hidden />}
      <div className="ad-main">
        <header className="ad-top">
          <button className="ad-btn ad-icon-btn ad-menu-btn" aria-label="Open menu" onClick={() => setDrawer(true)}><Menu aria-hidden /></button>
          <form className="ad-search" role="search" onSubmit={(e) => {
            e.preventDefault();
            const q = searchRef.current?.value.trim();
            if (q) router.push(`/admin/search?q=${encodeURIComponent(q)}`);
          }}>
            <Search aria-hidden />
            <input ref={searchRef} type="search" name="q" placeholder="Search users, e-mails, IDs, tickets, reports…" aria-label="Search admin" />
            <kbd className="ad-hide-sm">/</kbd>
          </form>
          <div className="ad-top-actions">
            <Suspense fallback={null}><RangePicker /></Suspense>
            <a className="ad-btn ad-hide-md" href="/app"><ExternalLink aria-hidden /> Open Zest Snap</a>
            <a className="ad-btn ad-btn-ghost ad-icon-btn ad-hide-md" href="https://zestsnap.app" target="_blank" rel="noreferrer" aria-label="View public site" title="View public site"><Globe aria-hidden /></a>
            <Alerts attention={attention} />
            <ProfileMenu {...admin} />
          </div>
        </header>
        <main className="ad-content" id="admin-main">{children}</main>
      </div>
    </div>
  );
}
