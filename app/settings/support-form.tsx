"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { productConfig } from "@/lib/product-config";

const supportCategories = [
  ["account", "Account"], ["billing", "Billing"], ["scan", "Scan problem"], ["planner", "Planner"], ["reminder", "Reminders"],
  ["calendar", "Calendar"], ["app", "App issue"], ["suggestion", "Suggestion"], ["other", "Other"],
] as const;
const reportKinds = [
  ["bug", "Something is broken"], ["scan_problem", "A scan failed"], ["incorrect_extraction", "Dates or details were wrong"],
  ["reminder", "Reminder problem"], ["calendar", "Calendar problem"], ["billing", "Billing problem"], ["broken_feature", "A feature doesn't work"], ["other", "Other"],
] as const;

/** Basic, non-identifying context that helps support reproduce a problem. No document contents. */
function context() {
  return {
    route: window.location.pathname,
    appVersion: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "dev",
    userAgent: navigator.userAgent.slice(0, 400),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

type Ticket = { id: string; number: number; subject: string; status: string; last_message_at: string };
type Message = { id: string; body: string; from_staff: boolean; created_at: string };
const ticketStatus: Record<string, string> = { new: "Sent", open: "Open", waiting: "Reply from Zest", resolved: "Resolved", closed: "Closed" };

/** The person's own conversations. RLS returns only their tickets and never internal staff notes. */
function Conversations() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const loadMessages = useCallback(async (id: string) => {
    const { data } = await createClient().from("support_messages" as never).select("id,body,from_staff,created_at").eq("ticket_id", id).order("created_at");
    setMessages((data as Message[] | null) || []);
  }, []);
  useEffect(() => {
    createClient().from("support_tickets" as never).select("id,number,subject,status,last_message_at").order("last_message_at", { ascending: false }).limit(10)
      .then(({ data }) => setTickets((data as Ticket[] | null) || []));
  }, []);
  if (!tickets.length) return null;
  return (
    <div className="supportThreads">
      <b>Your conversations</b>
      {tickets.map((t) => (
        <div key={t.id} className="supportThread">
          <button type="button" onClick={() => { setNote(""); if (open === t.id) return setOpen(null); setOpen(t.id); loadMessages(t.id); }} aria-expanded={open === t.id}>
            <span>#{t.number} · {t.subject}</span><small>{ticketStatus[t.status] || t.status}</small>
          </button>
          {open === t.id && (
            <div className="supportMessages">
              {messages.map((m) => <p key={m.id} className={m.from_staff ? "staff" : ""}><small>{m.from_staff ? "Zest Snap" : "You"} · {new Date(m.created_at).toLocaleString()}</small>{m.body}</p>)}
              {t.status !== "closed" && (
                <form onSubmit={async (e) => {
                  e.preventDefault();
                  if (!reply.trim()) return;
                  setBusy(true);
                  const { error } = await createClient().rpc("reply_support_ticket" as never, { p_ticket: t.id, p_body: reply } as never);
                  setBusy(false);
                  if (error) return setNote("Couldn't send. Please try again.");
                  setReply(""); setNote("Sent"); loadMessages(t.id);
                }}>
                  <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={3} maxLength={5000} placeholder="Reply…" aria-label="Reply" />
                  <button className="button alt" disabled={busy}>{busy ? "Sending…" : "Send reply"}</button>
                  {note && <small>{note}</small>}
                </form>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function SupportForm({ kind, onDone }: { kind: "support" | "report"; onDone: (message: string) => void }) {
  const [category, setCategory] = useState(kind === "support" ? "other" : "bug");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [requestId, setRequestId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return setError("Tell us a little more first.");
    setBusy(true);
    setError("");
    const db = createClient();
    const { data, error } =
      kind === "support"
        ? await db.rpc("create_support_ticket" as never, { p_subject: subject, p_category: category, p_body: body, p_context: context() } as never)
        : await db.rpc("submit_user_report" as never, {
            p_kind: category,
            p_description: body,
            p_context: { ...context(), requestId: /^[0-9a-f-]{36}$/i.test(requestId.trim()) ? requestId.trim() : undefined },
          } as never);
    setBusy(false);
    if (error) {
      return setError(
        error.message.includes("too_many_requests")
          ? "You've sent several requests today. We'll reply to those first."
          : `We couldn't send this right now. Email ${productConfig.supportEmail} instead.`,
      );
    }
    const number = (data as { number?: number } | null)?.number;
    onDone(kind === "support" ? `Message sent${number ? ` · ticket #${number}` : ""}. We'll reply soon.` : `Thanks — report${number ? ` #${number}` : ""} received.`);
  }

  return (
    <>
    {kind === "support" && <Conversations />}
    <form className="supportForm" onSubmit={submit}>
      <label>
        <span>{kind === "support" ? "Topic" : "What happened?"}</span>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {(kind === "support" ? supportCategories : reportKinds).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      {kind === "support" && (
        <label>
          <span>Subject</span>
          <input value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} placeholder="Short summary" />
        </label>
      )}
      <label>
        <span>{kind === "support" ? "Message" : "Details"}</span>
        <textarea value={body} maxLength={kind === "support" ? 5000 : 4000} rows={5} onChange={(e) => setBody(e.target.value)}
          placeholder={kind === "support" ? "How can we help?" : "What did you expect, and what happened instead?"} />
      </label>
      {kind === "report" && (
        <label>
          <span>Request ID (optional)</span>
          <input value={requestId} onChange={(e) => setRequestId(e.target.value)} placeholder="Shown with scan errors" />
        </label>
      )}
      {error && <p role="alert" className="supportFormError">{error}</p>}
      <button className="button" disabled={busy}>{busy ? "Sending…" : kind === "support" ? "Send message" : "Send report"}</button>
      <small>We include your app version, device type and current page to help us fix things. We never include your documents.</small>
    </form>
    </>
  );
}
