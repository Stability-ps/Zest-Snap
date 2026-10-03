import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/app",
    name: "Zest Snap",
    short_name: "Zest Snap",
    description:
      "Turn photos, screenshots and PDFs into actionable calendar events, reminders and deadlines.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#F7FAFC",
    theme_color: "#0B1F3B",
    orientation: "any",
    categories: ["productivity", "utilities"],
    shortcuts: [
      {
        name: "Scan something",
        short_name: "Scan",
        url: "/app?capture=1",
        icons: [
          {
            src: "/icons/zest-maskable.svg",
            sizes: "any",
            type: "image/svg+xml",
          },
        ],
      },
      {
        name: "Open agenda",
        short_name: "Agenda",
        url: "/app?view=calendar",
        icons: [
          {
            src: "/icons/zest-maskable.svg",
            sizes: "any",
            type: "image/svg+xml",
          },
        ],
      },
    ],
    icons: [
      {
        src: "/icons/zest-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/zest-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/zest-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/zest-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icons/zest-maskable.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
