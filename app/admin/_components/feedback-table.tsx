import Link from "next/link";
import { fmtDateTime } from "@/lib/admin/format";
import { ModalForm } from "./forms";
import { PlanBadge, StatusBadge } from "./ui";
import { updateFeedback } from "../actions";

const feedbackStatuses = ["new", "reviewed", "planned", "resolved", "archived"];

export function Stars({ n }: { n: number | null }) {
  if (!n) return <span className="zadm-sub" style={{ display: "inline" }}>No rating</span>;
  return <span aria-label={`${n} out of 5 stars`} style={{ color: "#c98500", letterSpacing: 1, whiteSpace: "nowrap" }}>{"★".repeat(n)}<span style={{ color: "#d6dde6" }}>{"★".repeat(5 - n)}</span></span>;
}

export function FeedbackTable({ rows, canAct }: { rows: any[]; canAct: boolean }) {
  return (
    <div className="zadm-table-wrap"><table className="zadm-table">
      <thead><tr><th>Date</th><th>User</th><th>Rating</th><th>Feedback</th><th>Plan</th><th>Status</th><th /></tr></thead>
      <tbody>{rows.map((f) => (
        <tr key={f.id}>
          <td className="nowrap">{fmtDateTime(f.created_at)}</td>
          <td>{f.user_id ? <Link className="zadm-row-link" href={`/admin/users/${f.user_id}`}>{f.email || "User"}</Link> : "Deleted user"}</td>
          <td><Stars n={f.rating} /></td>
          <td style={{ maxWidth: 420 }}>{f.feedback ? <span style={{ whiteSpace: "pre-wrap" }}>{f.feedback}</span> : <span className="zadm-sub">Rating only</span>}{f.admin_note && <span className="zadm-sub">Note: {f.admin_note}</span>}</td>
          <td><PlanBadge plan={f.plan} /></td>
          <td><StatusBadge status={f.status} /></td>
          <td>
            <ModalForm trigger="Triage" triggerClassName="zadm-btn zadm-btn-sm" title="Triage feedback" action={updateFeedback} submitLabel="Save" disabled={!canAct}>
              <input type="hidden" name="id" value={f.id} />
              <label className="zadm-field">Status
                <select className="zadm-select" name="status" defaultValue={f.status}>{feedbackStatuses.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</select>
              </label>
              <label className="zadm-field">Internal note<textarea className="zadm-textarea" name="note" maxLength={2000} defaultValue={f.admin_note || ""} /></label>
            </ModalForm>
          </td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}
