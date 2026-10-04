"use client";
import { RefreshCw, XCircle } from "lucide-react";

/** Never shows raw errors; the digest lets us correlate with server logs. */
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="ad-card">
      <div className="ad-empty">
        <div className="ad-empty-icon"><XCircle aria-hidden /></div>
        <h3>This page couldn&apos;t load</h3>
        <p>Something went wrong on our side. Try again — if it keeps happening, check System Health.</p>
        {error.digest && <p className="ad-mono">Reference {error.digest}</p>}
        <div style={{ display: "flex", gap: 8 }}>
          <button className="ad-btn ad-btn-primary" onClick={reset}><RefreshCw aria-hidden /> Retry</button>
          <a className="ad-btn" href="/admin/health">System health</a>
        </div>
      </div>
    </div>
  );
}
