import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/supabase/admin";
export async function DELETE(req: Request) {
  if (
    req.headers.get("origin") !== new URL(req.url).origin ||
    req.headers.get("X-Zest-Action") !== "delete-account"
  )
    return NextResponse.json({ error: "Invalid request" }, { status: 403 });
  try {
    const db = await createClient();
    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user)
      return NextResponse.json({ error: "Sign in first" }, { status: 401 });
    const admin = serviceClient();
    const { data: files, error: listError } = await admin.storage
      .from("scan-sources")
      .list(user.id, { limit: 1000 });
    if (listError) throw listError;
    if (files?.length) {
      const { error } = await admin.storage
        .from("scan-sources")
        .remove(files.map((f) => `${user.id}/${f.name}`));
      if (error) throw error;
    }
    await db.auth.signOut({ scope: "global" });
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) throw error;
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Could not delete account. Try again." },
      { status: 503 },
    );
  }
}
