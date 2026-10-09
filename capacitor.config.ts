import type { CapacitorConfig } from "@capacitor/cli";
import { KeyboardResize } from "@capacitor/keyboard";

/**
 * Zest Snap native shell (iOS + Android).
 *
 * The apps load the production web app (https://app.zestsnap.app) because Zest Snap depends on
 * server-side Next.js routes (AI extraction, auth callbacks, admin) that a static export cannot provide.
 * Native capabilities are reached from the shared web code through lib/native/*. See docs/mobile/README.md.
 *
 * CAP_SERVER_URL is a local-testing override only, e.g.
 *   CAP_SERVER_URL=http://10.0.2.2:3100 npm run mobile:sync
 */
const serverUrl = process.env.CAP_SERVER_URL ?? "https://app.zestsnap.app/app";
const { hostname, protocol } = new URL(serverUrl);
if (hostname.endsWith(".vercel.app")) throw new Error("CAP_SERVER_URL must not point to a Vercel preview deployment.");
if (protocol !== "https:" && !process.env.CAP_SERVER_URL) throw new Error("The production server URL must use HTTPS.");

const config: CapacitorConfig = {
  appId: "app.zestsnap",
  appName: "Zest Snap",
  webDir: "mobile/www",
  server: {
    url: serverUrl,
    // Capacitor only keeps navigations that start with server.url inside the WebView and hands every other
    // top-level navigation to Safari. server.url ends in /app, so without this /settings, /login,
    // /reset-password and /auth/callback opened Safari (and sign-in landed in Safari, not the app).
    allowNavigation: [hostname],
    cleartext: protocol === "http:",
    // Branded offline / retry page bundled in the app, shown instead of a raw WebView error.
    errorPath: "offline.html",
  },
  backgroundColor: "#0B1F3B",
  ios: {
    contentInset: "never",
  },
  android: {
    allowMixedContent: false,
    captureInput: false,
  },
  plugins: {
    SystemBars: {
      // The site declares viewport-fit=cover; avoids a resize jump when the page commits.
      insetsHandling: "native",
      initialViewportFitValueHint: "cover",
    },
    SplashScreen: {
      // Hidden by the web app (lib/native/bridge) as soon as the first screen renders; the duration is only a safety cap.
      launchShowDuration: 8000,
      launchAutoHide: true,
      launchFadeOutDuration: 200,
      backgroundColor: "#0B1F3B",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
      splashFullScreen: false,
      splashImmersive: false,
    },
    StatusBar: {
      overlaysWebView: true,
      style: "LIGHT",
      backgroundColor: "#00000000",
    },
    Keyboard: {
      resize: KeyboardResize.Native,
      resizeOnFullScreen: true,
    },
    LocalNotifications: {
      smallIcon: "ic_stat_zest",
      iconColor: "#00C6A7",
    },
    PushNotifications: {
      // iOS: show Shared messages, invitations and briefings even while the app is open.
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
