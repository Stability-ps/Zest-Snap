import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Zest Snap",
    short_name: "Zest Snap",
    description: "Turn photos, screenshots and PDFs into actionable calendar events, reminders and deadlines.",
    start_url: "/app",
    display: "standalone",
    background_color: "#F7FAFC",
    theme_color: "#0B1F3B",
    orientation: "any",
    categories: ["productivity", "utilities"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" }
    ]
  };
}
