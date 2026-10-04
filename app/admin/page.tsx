import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { revalidatePath } from "next/cache";
export const dynamic = "force-dynamic";
const allowed = [
  "profiles",
  "scans",
  "events",
  "usage_monthly",
  "reward_ledger",
  "referrals",
  "subscriptions",
  "calendar_connections",
  "reminders",
  "scan_requests",
  "admin_content",
  "reward_rules",
  "plan_rules",
  "feature_flags",
  "referral_invites",
] as const;
async function authorized() {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  // public.is_admin() was replaced by private.is_admin() (not exposed over the API). Reading the caller's
  // own row is allowed by RLS; every admin write is still authorised again by database policies.
  const { data, error } = await db.from("profiles").select("is_admin").eq("id", user.id).single();
  if (error || data?.is_admin !== true) redirect("/app");
  return db;
}
async function toggle(form: FormData) {
  "use server";
  const db = await authorized();
  const key = String(form.get("key"));
  const { error } = await db
    .from("feature_flags")
    .update({
      enabled: form.get("enabled") === "true",
      updated_at: new Date().toISOString(),
    })
    .eq("key", key);
  if (error) throw new Error("Could not update feature flag");
  revalidatePath("/admin");
}
async function updatePlan(form: FormData) {
  "use server";
  const db = await authorized();
  const scans = Number(form.get("scans")),
    pages = Number(form.get("pages"));
  if (
    !Number.isInteger(scans) ||
    scans < 0 ||
    scans > 100000 ||
    !Number.isInteger(pages) ||
    pages < 1 ||
    pages > 100
  )
    throw new Error("Invalid allowance");
  const { error } = await db
    .from("plan_rules")
    .update({ monthly_scans: scans, pdf_pages: pages })
    .eq("id", String(form.get("id")));
  if (error) throw new Error("Could not save plan");
  revalidatePath("/admin");
}
async function updateContent(form: FormData) {
  "use server";
  const db = await authorized();
  const key = String(form.get("key")),
    body = String(form.get("body"));
  if (!/^[a-z0-9_-]{1,60}$/.test(key) || body.length > 10000)
    throw new Error("Invalid content");
  const { error } = await db
    .from("admin_content")
    .upsert({ key, body, updated_at: new Date().toISOString() });
  if (error) throw new Error("Could not save content");
  revalidatePath("/admin");
}
export default async function Admin({
  searchParams,
}: {
  searchParams: Promise<{ table?: string; page?: string }>;
}) {
  if (!isSupabaseConfigured())
    return (
      <main className="settingsPage">
        <h1>Admin setup</h1>
        <p>
          Dedicated cloud storage is not active. No live metrics are available.
        </p>
        <a href="/app">Return to Zest Snap</a>
      </main>
    );
  const db = await authorized();
  const params = await searchParams;
  const table = allowed.find((t) => t === params.table) || "profiles";
  const page = Math.max(0, Math.min(10000, Number(params.page) || 0));
  const [records, flags, plans] = await Promise.all([
    db
      .from(table)
      .select("*", { count: "exact" })
      .range(page * 25, page * 25 + 24),
    db.from("feature_flags").select("*").order("key"),
    db.from("plan_rules").select("*"),
  ]);
  return (
    <main className="settingsPage">
      <div className="settingsWrap">
        <a href="/app">← App</a>
        <h1>Zest Snap admin</h1>
        <p>
          Live records · access enforced on the server and by database policies.
        </p>
        <nav className="settingsActions">
          {allowed.map((t) => (
            <a key={t} href={"/admin?table=" + t}>
              {t.replaceAll("_", " ")}
            </a>
          ))}
        </nav>
        <h2>{table.replaceAll("_", " ")}</h2>
        {records.error ? (
          <p role="alert">Could not load records.</p>
        ) : (
          <>
            <p>
              {records.count} records · page {page + 1}
            </p>
            <div className="adminRecords">
              {records.data?.map((r, i) => (
                <details key={i}>
                  <summary>
                    {String(
                      r.display_name ||
                        r.title ||
                        r.file_name ||
                        r.id ||
                        r.user_id ||
                        r.key,
                    )}
                  </summary>
                  <pre>{JSON.stringify(r, null, 2)}</pre>
                </details>
              ))}
            </div>
            <p>
              {page > 0 && (
                <a href={`/admin?table=${table}&page=${page - 1}`}>Previous</a>
              )}{" "}
              · <a href={`/admin?table=${table}&page=${page + 1}`}>Next</a>
            </p>
          </>
        )}
        <h2>Feature flags</h2>
        {flags.data?.map((f) => (
          <form action={toggle} key={f.key}>
            <input hidden name="key" value={f.key} readOnly />
            <input hidden name="enabled" value={String(!f.enabled)} readOnly />
            <button>
              {f.key}: {f.enabled ? "On" : "Off"} — change
            </button>
          </form>
        ))}
        <h2>Plan allowances</h2>
        {plans.data?.map((p) => (
          <form action={updatePlan} key={p.id} className="settingsForm">
            <h3>{p.id}</h3>
            <input name="id" hidden value={p.id} readOnly />
            <label>
              Monthly scans
              <input
                type="number"
                min="0"
                max="100000"
                name="scans"
                defaultValue={p.monthly_scans}
              />
            </label>
            <label>
              PDF pages
              <input
                type="number"
                min="1"
                max="100"
                name="pages"
                defaultValue={p.pdf_pages}
              />
            </label>
            <button>Save allowance</button>
          </form>
        ))}
        <h2>Content & notification drafts</h2>
        <p>
          Stored drafts only. These do not publish legal changes or send
          notifications.
        </p>
        <form action={updateContent} className="settingsForm">
          <label>
            Key
            <input name="key" required pattern="[a-z0-9_-]{1,60}" />
          </label>
          <label>
            Body
            <textarea name="body" required maxLength={10000} />
          </label>
          <button>Save draft</button>
        </form>
      </div>
    </main>
  );
}
