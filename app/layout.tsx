import type { Metadata, Viewport } from "next";
import "./theme.css";
import "./globals.css";
import ReferralCapture from "./referral-capture";
import NativeBridge from "./native-bridge";
import AppearanceProvider from "./appearance-provider";
import { APPEARANCE_BOOT_SCRIPT } from "@/lib/appearance/boot";
import { THEME_COLOR } from "@/lib/appearance/palette";

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
  // Lets the browser paint its pre-CSS canvas dark on dark devices (the stylesheet then applies the chosen theme).
  colorScheme: "light dark",
  // Without JavaScript the OS scheme decides; the boot script replaces both with the person's own choice.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLOR.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLOR.dark },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The head scripts set the theme (data-theme/data-accent) and, inside the iOS/Android apps, the native class
    // before first paint, so neither the colours nor the safe-area layout jump; hence suppressHydrationWarning.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_BOOT_SCRIPT }} />
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
        <AppearanceProvider />
      </body>
    </html>
  );
}
