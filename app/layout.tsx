import type { Metadata, Viewport } from "next";
import "./globals.css";
import PwaRegister from "./pwa-register";

export const metadata: Metadata = {
  title: "Zest Snap — Anything with a date becomes actionable",
  description:
    "AI-powered calendar assistant that turns photos, screenshots and PDFs into actionable events, reminders and deadlines.",
  icons: {
    icon: [
      { url: "/icons/zest-snap-mark.svg", type: "image/svg+xml" },
      { url: "/icons/zest-snap-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [
      {
        url: "/icons/zest-snap-apple-touch.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  applicationName: "Zest Snap",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Zest Snap",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0B1F3B",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
