import type { Metadata, Viewport } from "next";
import "./globals.css";
import ReferralCapture from "./referral-capture";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://zestsnap.app"),
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Zest Snap",
    title: "Zest Snap — Anything with a date becomes actionable",
    description: "Turn photos, screenshots and PDFs into reviewed events, tasks, deadlines and reminders.",
    images: [{ url: "/icons/zest-snap-512.png", width: 512, height: 512, alt: "Zest Snap" }],
  },
  title: "Zest Snap — Anything with a date becomes actionable",
  description:
    "AI-powered calendar assistant that turns photos, screenshots and PDFs into actionable events, reminders and deadlines.",
  applicationName: "Zest Snap",
  formatDetection: {
    telephone: false,
  },
  appleWebApp: {
    capable: true,
    title: "Zest Snap",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      {
        url: "/icons/favicon-32x32.png",
        sizes: "32x32",
        type: "image/png",
      },
      {
        url: "/icons/zest-snap-192.png",
        sizes: "192x192",
        type: "image/png",
      },
    ],
    shortcut: "/favicon.ico",
    apple: [
      {
        url: "/icons/zest-snap-apple-touch.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0B1F3B",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
        <ReferralCapture />
      </body>
    </html>
  );
}
