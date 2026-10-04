import { NextResponse } from "next/server";

/**
 * Android App Links verification. ANDROID_CERT_SHA256 lists the release (Play App Signing) certificate
 * fingerprints, comma-separated — public values from Play Console › App integrity. 404 until configured.
 */
export function GET() {
  const prints = (process.env.ANDROID_CERT_SHA256 || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(s));
  if (!prints.length) return new NextResponse("Not found", { status: 404 });
  return NextResponse.json(
    [
      {
        relation: ["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"],
        target: { namespace: "android_app", package_name: "app.zestsnap", sha256_cert_fingerprints: prints },
      },
    ],
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
