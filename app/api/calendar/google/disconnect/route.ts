import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/supabase/admin";
import { getGoogleConnection } from "@/lib/google-calendar-server";

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });

  const connection = await getGoogleConnection(user.id);
  if (connection?.access_token) {
    fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(connection.access_token), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }).catch(() => undefined);
  }

  const { error } = await serviceClient().from("calendar_connections").delete().eq("user_id", user.id).eq("provider", "google");
  if (error) return NextResponse.json({ error: "disconnect_failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
