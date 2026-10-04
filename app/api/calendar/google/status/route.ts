import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getGoogleConnection } from "@/lib/google-calendar-server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ connected: false }, { status: 401 });
  const connection = await getGoogleConnection(user.id);
  return NextResponse.json({
    connected: Boolean(connection),
    email: connection?.calendar_email || null,
  });
}
