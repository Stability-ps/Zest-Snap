import type { Metadata } from "next";
import PwaRegister from "../pwa-register";
import ActivityPing from "./activity-ping";

export const metadata: Metadata = {
  metadataBase: new URL("https://app.zestsnap.app"),
  alternates: { canonical: "/app" },
  manifest: "/manifest.webmanifest",
  applicationName: "Zest Snap",
  appleWebApp: { capable: true, title: "Zest Snap", statusBarStyle: "default" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}<PwaRegister /><ActivityPing /></>;
}
