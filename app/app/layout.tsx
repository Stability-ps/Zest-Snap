import type { Metadata } from "next";
import PwaRegister from "../pwa-register";
import ActivityPing from "./activity-ping";
import { INTRO_BOOT_SCRIPT } from "@/lib/intro";

export const metadata: Metadata = {
  metadataBase: new URL("https://app.zestsnap.app"),
  alternates: { canonical: "/app" },
  manifest: "/manifest.webmanifest",
  applicationName: "Zest Snap",
  appleWebApp: { capable: true, title: "Zest Snap", statusBarStyle: "default" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Brand-new devices see the one-time intro first (lib/intro.ts); runs before Home paints. */}
      <script dangerouslySetInnerHTML={{ __html: INTRO_BOOT_SCRIPT }} />
      {children}
      <PwaRegister />
      <ActivityPing />
    </>
  );
}
