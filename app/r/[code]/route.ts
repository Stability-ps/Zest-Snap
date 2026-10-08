import { NextRequest, NextResponse } from "next/server";

const CODE = /^[A-Za-z0-9_-]{6,64}$/;

export async function GET(request: NextRequest, context: { params: Promise<{ code: string }> }) {
  const { code } = await context.params;
  const target = new URL("/", request.url);
  if (CODE.test(code)) target.searchParams.set("ref", code);
  return NextResponse.redirect(target, 307);
}
