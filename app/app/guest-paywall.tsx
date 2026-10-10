"use client";
import { useEffect, useRef } from "react";
import { Sparkles, UserPlus, X } from "lucide-react";
import { trackConversion } from "@/lib/conversion";

/**
 * Shown when a guest who has used the free trial scans tries another scan. Their existing scans and plans
 * stay available; nothing here blocks them. Account creation is as prominent as the paid option.
 */
export default function GuestPaywall({ onClose, onCreateAccount, onExplore }: { onClose: () => void; onCreateAccount: () => void; onExplore: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    trackConversion("guest_limit_reached", "guest_limit");
    trackConversion("guest_paywall_viewed", "guest_limit");
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="paywallOverlay" onClick={onClose}>
      <section className="paywallSheet" role="dialog" aria-modal="true" aria-labelledby="guest-paywall-title" onClick={(e) => e.stopPropagation()}>
        <button ref={closeRef} type="button" className="iconButton paywallClose" onClick={onClose} aria-label="Not now">
          <X />
        </button>
        <span className="paywallMark" aria-hidden="true">
          <Sparkles />
        </span>
        <h2 id="guest-paywall-title">You’ve captured 3 important moments.</h2>
        <p className="paywallLead">Ready for more?</p>
        <p>Unlock more AI scans, smarter planning and reminders that keep everything organised. Everything you’ve scanned so far stays right here.</p>
        <div className="paywallActions">
          <button type="button" className="button" onClick={onExplore}>
            <Sparkles size={18} aria-hidden="true" /> Explore Premium
          </button>
          <button
            type="button"
            className="button alt"
            onClick={() => {
              trackConversion("free_registration_started", "guest_limit");
              onCreateAccount();
            }}
          >
            <UserPlus size={18} aria-hidden="true" /> Create a free account — get 3 more scans
          </button>
          <small>No payment required. Your scans and plans move to your new account.</small>
        </div>
      </section>
    </div>
  );
}
