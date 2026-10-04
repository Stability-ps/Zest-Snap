/** Admin roles narrow what an admin may do. profiles.is_admin remains the master switch, enforced again in the database. */
export type AdminRole = "owner" | "admin" | "support" | "analyst";
export type Permission = "view" | "support" | "operate" | "export" | "owner";

const ladder: Record<Permission, AdminRole[]> = {
  view: ["owner", "admin", "support", "analyst"],
  support: ["owner", "admin", "support"],
  operate: ["owner", "admin"],
  export: ["owner", "admin", "analyst"],
  owner: ["owner"],
};

export function can(role: AdminRole | null | undefined, permission: Permission) {
  return !!role && ladder[permission].includes(role);
}

export function isAdminRole(value: unknown): value is AdminRole {
  return value === "owner" || value === "admin" || value === "support" || value === "analyst";
}

/** Pure access decision for /admin, so the gate is unit-testable without a database. */
export function adminAccess(user: { id: string } | null, profile: { is_admin?: boolean | null } | null) {
  if (!user) return "sign_in" as const;
  return profile?.is_admin === true ? ("allowed" as const) : ("denied" as const);
}

export const roleLabels: Record<AdminRole, string> = {
  owner: "Owner",
  admin: "Admin",
  support: "Support",
  analyst: "Analyst",
};
