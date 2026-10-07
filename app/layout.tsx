import type { Metadata, Viewport } from "next";
import "./globals.css";
import ReferralCapture from "./referral-capture";
import NativeBridge from "./native-bridge";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://zestsnap.app"),
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Zest Snap",
    title: "Zest Snap",
    description: "Turn anything with a date into a plan.",
    images: [{ url: "/icons/zest-snap-512.png", width: 512, height: 512, alt: "Zest Snap" }],
  },
  title: "Zest Snap",
  description:
    "Turn anything with a date into a plan.",
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
    // The class is added before first paint inside the iOS/Android apps (Capacitor injects its bridge at document
    // start), so native safe-area styles apply without a layout jump; hence suppressHydrationWarning.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{var c=window.Capacitor;if(c&&c.isNativePlatform&&c.isNativePlatform()){var d=document.documentElement;d.classList.add("native","native-"+c.getPlatform());d.dataset.runtime=c.getPlatform()}}catch(e){}',
          }}
        />
      </head>
      <body>
        {children}
        <ReferralCapture />
        <NativeBridge />
      </body>
    </html>
  );
}
