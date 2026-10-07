import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, ChevronRight, Database, Inbox, Info, Minus, RefreshCw, XCircle } from "lucide-react";
import { fmtNumber } from "@/lib/admin/format";

export function PageHeader({ title, description, crumbs, actions }: {
  title: string;
  description?: ReactNode;
  crumbs?: { href?: string; label: string }[];
  actions?: ReactNode;
}) {
  return (
    <header className="zadm-page-head">
      <div>
        {crumbs && (
          <nav className="zadm-crumbs" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <span key={i} style={{ display: "contents" }}>
                {i > 0 && <ChevronRight size={12} aria-hidden />}
                {c.href ? <Link href={c.href}>{c.label}</Link> : <span>{c.label}</span>}
              </span>
            ))}
          </nav>
        )}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="zadm-hezadm-actions">{actions}</div>}
    </header>
  );
}

export function Card({ title, description, actions, children, flush, className }: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  className?: string;
}) {
  return (
    <section className={"zadm-card" + (className ? " " + className : "")}>
      {(title || actions) && (
        <div className="zadm-card-head">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className={"zadm-card-body" + (flush ? " flush" : "")}>{children}</div>
    </section>
  );
}

export function Delta({ value, invert }: { value: number | null; invert?: boolean }) {
  if (value === null) return null;
  const pct = Math.abs(value * 100);
  const dir = pct < 0.5 ? "flat" : (value > 0) !== !!invert ? "up" : "down";
  const Icon = pct < 0.5 ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`zadm-delta ${dir}`} title="Change vs previous comparable period">
      <Icon aria-hidden />
      {pct >= 1000 ? ">999" : pct.toFixed(pct < 10 ? 1 : 0)}%
    </span>
  );
}

/** A KPI tile. `value === null` renders an honest "not available" state instead of a number. */
export function Kpi({ label, value, icon, delta, foot, href, unavailable, invert }: {
  label: string;
  value: ReactNode | null;
  icon?: ReactNode;
  delta?: number | null;
  foot?: ReactNode;
  href?: string;
  unavailable?: string;
  invert?: boolean;
}) {
  const body = (
    <>
      <span className="zadm-kpi-label">{icon}{label}</span>
      {value === null || value === undefined ? (
        <span className="zadm-kpi-value muted">{unavailable || "No data yet"}</span>
      ) : (
        <span className="zadm-kpi-value">{typeof value === "number" ? fmtNumber(value) : value}</span>
      )}
      <span className="zadm-kpi-foot">
        {delta !== undefined && <Delta value={delta ?? null} invert={invert} />}
        {foot}
      </span>
    </>
  );
  return href ? <Link className="zadm-kpi" href={href}>{body}</Link> : <div className="zadm-kpi">{body}</div>;
}

export function Kpis({ children }: { children: ReactNode }) {
  return <div className="zadm-kpis">{children}</div>;
}

export type Tone = "good" | "warn" | "bad" | "info" | "navy" | "neutral";
export function Badge({ tone = "neutral", children, icon }: { tone?: Tone; children: ReactNode; icon?: ReactNode }) {
  return <span className={`zadm-badge ${tone === "neutral" ? "" : tone}`}>{icon}{children}</span>;
}

const statusTones: Record<string, Tone> = {
  completed: "good", active: "good", resolved: "good", sent: "good", succeeded: "good", published: "good", qualified: "good", rewarded: "good", handled: "good", trialing: "info",
  failed: "bad", disabled: "bad", urgent: "bad", past_due: "bad", wont_fix: "neutral", canceled: "neutral", cancelled: "neutral", closed: "neutral", archived: "neutral",
  new: "info", open: "info", triaged: "info", in_progress: "info", planned: "info", signed_up: "info", draft: "neutral", reviewed: "neutral",
  waiting: "warn", reserved: "warn", pending: "warn", processing: "warn", high: "warn", invited: "neutral", low: "neutral", normal: "neutral",
};
const statusLabels: Record<string, string> = { waiting: "Waiting on user", wont_fix: "Won't fix", in_progress: "In progress", signed_up: "Signed up", past_due: "Past due", reserved: "Processing" };

export function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <Badge>—</Badge>;
  const label = statusLabels[status] || status.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());
  return <Badge tone={statusTones[status] || "neutral"}>{label}</Badge>;
}

export function PlanBadge({ plan }: { plan: string | null | undefined }) {
  if (!plan) return <Badge>—</Badge>;
  return <Badge tone={plan === "business" ? "navy" : plan === "plus" ? "info" : "neutral"}>{plan === "plus" ? "Plus" : plan.replace(/^\w/, (c) => c.toUpperCase())}</Badge>;
}

export function Empty({ title, children, icon, action }: { title: string; children?: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="zadm-empty">
      <div className="zadm-empty-icon">{icon || <Inbox aria-hidden />}</div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "warn" | "bad" | "good"; title?: string; children?: ReactNode }) {
  const Icon = tone === "good" ? CheckCircle2 : tone === "bad" ? XCircle : tone === "warn" ? AlertTriangle : Info;
  return (
    <div className={`zadm-notice ${tone}`} role={tone === "bad" ? "alert" : undefined}>
      <Icon aria-hidden />
      <div>
        {title && <b>{title}</b>}
        {children}
      </div>
    </div>
  );
}

/** Friendly error with retry. Raw database errors are never shown. */
export function LoadError({ error, retryHref }: { error: { code: string; message: string }; retryHref?: string }) {
  if (error.code === "not_ready") return <NotReady />;
  return (
    <Empty title="Couldn't load this" icon={<XCircle aria-hidden />}
      action={retryHref ? <a className="zadm-btn zadm-btn-sm" href={retryHref}><RefreshCw aria-hidden /> Retry</a> : undefined}>
      {error.message}
    </Empty>
  );
}

export function NotReady() {
  return (
    <Empty title="Database upgrade pending" icon={<Database aria-hidden />}>
      This section needs the <span className="zadm-mono">20261005090000_admin_console</span> migration. Apply it in Supabase and reload — nothing else needs to change.
    </Empty>
  );
}

export function Pager({ total, page, pageSize, href }: { total: number; page: number; pageSize: number; href: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize && page === 0) return total ? <div className="zadm-pager"><span>{fmtNumber(total)} {total === 1 ? "result" : "results"}</span></div> : null;
  return (
    <div className="zadm-pager">
      <span>
        {fmtNumber(page * pageSize + 1)}–{fmtNumber(Math.min(total, (page + 1) * pageSize))} of {fmtNumber(total)}
      </span>
      <div>
        {page > 0 ? <Link className="zadm-btn zadm-btn-sm" href={href(page - 1)}>Previous</Link> : <span className="zadm-btn zadm-btn-sm" aria-disabled style={{ opacity: 0.45 }}>Previous</span>}
        {page + 1 < pages ? <Link className="zadm-btn zadm-btn-sm" href={href(page + 1)}>Next</Link> : <span className="zadm-btn zadm-btn-sm" aria-disabled style={{ opacity: 0.45 }}>Next</span>}
      </div>
    </div>
  );
}

export function Tabs({ tabs, current }: { tabs: { key: string; label: string; href: string; count?: number }[]; current: string }) {
  return (
    <nav className="zadm-tabs" aria-label="Sections">
      {tabs.map((t) => (
        <Link key={t.key} className="zadm-tab" href={t.href} aria-current={t.key === current ? "page" : undefined}>
          {t.label}{t.count ? ` · ${fmtNumber(t.count)}` : ""}
        </Link>
      ))}
    </nav>
  );
}

export function Chips({ items, current }: { items: { key: string; label: string; href: string; count?: number }[]; current: string }) {
  return (
    <div className="zadm-chips" role="group">
      {items.map((c) => (
        <Link key={c.key} className="zadm-chip" href={c.href} aria-current={c.key === current ? "true" : undefined}>
          {c.label}{c.count !== undefined && <b>{fmtNumber(c.count)}</b>}
        </Link>
      ))}
    </div>
  );
}

/** Horizontal bars for comparing categories. Values are always printed next to each bar. */
export function BarList({ data, format = (n) => fmtNumber(n), empty = "No data in this period." }: {
  data: { label: ReactNode; value: number; key?: string }[];
  format?: (n: number) => string;
  empty?: string;
}) {
  const rows = data.filter((d) => Number.isFinite(d.value));
  const max = Math.max(0, ...rows.map((d) => d.value));
  if (!rows.length || max === 0) return <p style={{ margin: 0, color: "var(--zadm-muted)" }}>{empty}</p>;
  return (
    <div className="zadm-bars">
      {rows.map((d, i) => (
        <div className="zadm-bar-row" key={d.key || i}>
          <span className="zadm-trunc">{d.label}</span>
          <span className="zadm-bar-track" aria-hidden><span className="zadm-bar-fill" style={{ width: `${(d.value / max) * 100}%`, display: "block" }} /></span>
          <span className="num">{format(d.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function Stats({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <div className="zadm-stats">
      {items.map((s) => (
        <div className="zadm-stat" key={s.label}>
          <span>{s.label}</span>
          <b>{typeof s.value === "number" ? fmtNumber(s.value) : s.value}</b>
        </div>
      ))}
    </div>
  );
}

export function DevDetails({ data }: { data: unknown }) {
  return (
    <details className="zadm-dev">
      <summary>Developer details</summary>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </details>
  );
}

export function Forbidden() {
  return (
    <Empty title="Not available for your role" icon={<AlertTriangle aria-hidden />}>
      Ask an Owner if you need access to this area.
    </Empty>
  );
}
