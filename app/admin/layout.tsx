import type { Metadata } from "next";
import "./admin.css";
import AdminShell, { type Attention } from "./_components/shell";
import { adminRpc, getAdmin } from "@/lib/admin/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: { default: "Admin · Zest Snap", template: "%s · Zest Snap Admin" },
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Gate for every /admin route. Each page and action re-checks on its own as well.
  const admin = await getAdmin();
  const attention = admin.schemaReady ? await adminRpc<Attention>("admin_attention") : null;
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  return (
    <AdminShell
      admin={{ name: admin.name, email: admin.email, role: admin.role }}
      attention={attention?.data ?? null}
      buildLabel={sha ? sha.slice(0, 7) : "local"}
    >
      {!admin.schemaReady && (
        <div className="ad-notice warn" role="status">
          <div>
            <b>Admin database upgrade pending</b>
            Apply migration <span className="ad-mono">20261005090000_admin_console.sql</span> to enable analytics, support, audit logging and roles. Existing data is untouched.
          </div>
        </div>
      )}
      {children}
    </AdminShell>
  );
}
