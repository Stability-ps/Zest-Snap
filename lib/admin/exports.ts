/** Export catalogue: dataset key → label, description and the exact CSV columns (headers are stable even when empty). */
export type ExportDef = { key: string; label: string; description: string; columns: string[]; dated: boolean; group: string };

export const exportDefs: ExportDef[] = [
  { key: "users", group: "Users", label: "Users", dated: true, description: "Accounts created in the range, with plan, status, credits and usage totals.",
    columns: ["user_id", "email", "name", "plan", "status", "locale", "timezone", "country_code", "created_at", "last_active_at", "last_sign_in_at", "credits", "planner_items", "ai_scans"] },
  { key: "activity", group: "Users", label: "User activity", dated: true, description: "One row per person per active day (recorded from this release).",
    columns: ["day", "user_id", "email", "first_seen_at", "last_seen_at", "hits"] },
  { key: "scans", group: "Product", label: "Scans", dated: true, description: "AI scan requests with status, type, events, duration and token metadata. No document content.",
    columns: ["request_id", "created_at", "user_id", "email", "status", "mime_type", "page_count", "event_count", "warning_count", "duration_ms", "error_code", "model", "input_tokens", "output_tokens", "estimated_cost_usd", "completed_at"] },
  { key: "usage", group: "Product", label: "Usage (monthly)", dated: true, description: "Monthly allowance usage per person.",
    columns: ["period_start", "user_id", "email", "ai_scans", "pdf_pages", "bonus_scans", "estimated_cost_usd"] },
  { key: "revenue", group: "Revenue", label: "Revenue", dated: true, description: "Succeeded charges and refunds.",
    columns: ["id", "occurred_at", "user_id", "email", "provider", "kind", "status", "amount", "currency", "plan", "country_code"] },
  { key: "revenue_summary", group: "Revenue", label: "Revenue summary", dated: true, description: "Gross, refunds and net per currency for the range.",
    columns: ["currency", "gross", "refunds", "net", "charges", "failed_payments", "paying_users"] },
  { key: "transactions", group: "Revenue", label: "Transactions", dated: true, description: "Every payment transaction, any status.",
    columns: ["id", "occurred_at", "user_id", "email", "provider", "kind", "status", "amount", "currency", "plan", "country_code", "failure_reason"] },
  { key: "subscriptions", group: "Revenue", label: "Subscriptions", dated: true, description: "Subscriptions updated in the range.",
    columns: ["id", "user_id", "email", "provider", "plan", "status", "current_period_start", "current_period_end", "cancel_at_period_end", "created_at", "canceled_at", "updated_at"] },
  { key: "failed_payments", group: "Revenue", label: "Failed payments", dated: true, description: "Charges that failed, with the provider's reason.",
    columns: ["id", "occurred_at", "user_id", "email", "provider", "amount", "currency", "plan", "failure_reason"] },
  { key: "refunds", group: "Revenue", label: "Refunds", dated: true, description: "Refund transactions.",
    columns: ["id", "occurred_at", "user_id", "email", "provider", "status", "amount", "currency", "plan"] },
  { key: "rewards", group: "Users", label: "Rewards ledger", dated: true, description: "Every Zest Credit earned, spent or adjusted.",
    columns: ["id", "created_at", "user_id", "email", "entry_type", "amount", "reason", "reference_type"] },
  { key: "referrals", group: "Users", label: "Referrals", dated: true, description: "Referral sign-ups and qualification.",
    columns: ["id", "created_at", "referrer_id", "referrer_email", "referred_user_id", "referred_email", "referral_code", "status", "qualified_at"] },
  { key: "ratings", group: "Customer", label: "Ratings & reviews", dated: true, description: "Ratings and written feedback with triage status.",
    columns: ["id", "created_at", "user_id", "email", "plan", "rating", "feedback", "status", "admin_note"] },
  { key: "tickets", group: "Customer", label: "Support tickets", dated: true, description: "Tickets (without message bodies).",
    columns: ["number", "created_at", "user_id", "email", "subject", "category", "status", "priority", "assignee", "tags", "first_response_at", "resolved_at", "last_message_at"] },
  { key: "reports", group: "Customer", label: "Reports / issues", dated: true, description: "Problem reports with app context.",
    columns: ["number", "created_at", "user_id", "email", "kind", "status", "priority", "description", "route", "app_version", "user_agent", "request_id", "resolved_at"] },
  { key: "audit", group: "Operations", label: "Audit log", dated: true, description: "Admin actions with before/after values.",
    columns: ["id", "created_at", "admin_email", "action", "object_type", "object_id", "before", "after"] },
];

export const exportByKey = (key: string) => exportDefs.find((d) => d.key === key);
