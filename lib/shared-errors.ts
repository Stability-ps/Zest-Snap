// Maps database error codes raised by the Shared RPCs and guards to messages people can act on.
const MESSAGES: Record<string, string> = {
  authentication_required: "Sign in to continue.",
  invite_unavailable: "This invitation has expired or was revoked. Ask for a new link.",
  invite_for_another_account: "This invitation was sent to a different email address. Sign in with that address to accept it.",
  delete_not_allowed: "Only the plan owner can delete this plan.",
  not_allowed: "Only the plan owner or an editor can do that.",
  member_not_found: "Tasks can only be assigned to people in this plan.",
  assignee_can_only_complete: "You can tick off tasks assigned to you, but only editors can change them.",
  owner_cannot_leave: "The owner can't leave their own plan.",
  invalid_name: "Give this shared plan a name.",
};

export function sharedErrorMessage(error: unknown, fallback: string) {
  const raw = error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String((error as { message: unknown }).message) : String(error || "");
  const code = Object.keys(MESSAGES).find((k) => raw.includes(k));
  return code ? MESSAGES[code] : fallback;
}
