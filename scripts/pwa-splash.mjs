// Generates the iOS home-screen (PWA) startup images in public/splash/ from the shared splash artwork.
// Safari ignores the web manifest's splash settings and shows a blank screen at launch unless a
// <link rel="apple-touch-startup-image"> matches the device's exact screen size, so there is one image per
// portrait screen size (lib/pwa-startup.ts lists them for the /app metadata). Run: npm run pwa:splash
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { splashSvg } from "./brand-splash.mjs";
import { PWA_STARTUP_SCREENS, startupImageFile } from "../lib/pwa-startup.ts";

const out = "public/splash";
mkdirSync(out, { recursive: true });

for (const s of PWA_STARTUP_SCREENS) {
  const w = s.width * s.ratio;
  const h = s.height * s.ratio;
  // ~36% of the screen width, the same share the native splash shows on a phone.
  const mark = Math.round(Math.min(0.36 * w, 0.2 * h));
  await sharp(splashSvg(w, h, mark), { density: 72 * s.ratio })
    .resize(w, h)
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(`${out}/${startupImageFile(s)}`);
}
console.log(`wrote ${PWA_STARTUP_SCREENS.length} startup images to ${out}`);
