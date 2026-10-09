import { NextResponse } from "next/server";

/**
 * iOS Universal Links for the Zest Snap app. Served only once APPLE_TEAM_ID is configured (it is public
 * information, not a secret) so a half-configured association is never published.
 */
export function GET() {
  const team = process.env.APPLE_TEAM_ID?.trim();
  if (!team || !/^[A-Z0-9]{10}$/.test(team)) return new NextResponse("Not found", { status: 404 });
  const appID = `${team}.app.zestsnap`;
  return NextResponse.json(
    {
      applinks: {
        details: [
          {
            appIDs: [appID],
            components: [
              { "/": "/app*" },
              { "/": "/auth/callback*" },
              { "/": "/auth/confirm*", comment: "Email verification and password reset links" },
              { "/": "/reset-password*" },
              { "/": "/login*" },
              { "/": "/settings*" },
              { "/": "/share/*", comment: "Shared plan invitations" },
              { "/": "/shared/*", comment: "Shared plans" },
            ],
          },
        ],
      },
      webcredentials: { apps: [appID] },
    },
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
