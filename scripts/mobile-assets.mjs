// Rasterises the approved Zest Snap brand SVGs (public/icons) into the source images @capacitor/assets needs.
// No new artwork: geometry and colours are taken verbatim from zest-snap-mark.svg / zest-snap-maskable.svg.
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const NAVY = "#0B1F3B";
const glyph = `<path d="M148 150h216c12 0 19 14 11 24L232 338h132v48H148c-12 0-19-14-11-24l143-164H148v-48Z" fill="#FFFFFF"/>
  <path d="M315 126h72l-42 58h48l-89 108 25-78h-48l34-88Z" fill="#00C6A7"/>`;
const svg = (body, size = 512) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">${body}</svg>`);
const out = "mobile/assets";
mkdirSync(out, { recursive: true });

// iOS/App Store icon: full-bleed square (the OS applies the corner mask; rounded art would leave white corners).
await sharp(svg(`<rect width="512" height="512" fill="${NAVY}"/>${glyph}`), { density: 1200 }).resize(1024, 1024).flatten({ background: NAVY }).png().toFile(`${out}/icon-only.png`);
// Android adaptive icon: solid navy background layer + glyph foreground scaled into the 66% safe zone.
await sharp(svg(`<rect width="512" height="512" fill="${NAVY}"/>`)).resize(1024, 1024).png().toFile(`${out}/icon-background.png`);
await sharp(svg(`<g transform="translate(256 256) scale(0.62) translate(-256 -256)">${glyph}</g>`), { density: 1200 }).resize(1024, 1024).png().toFile(`${out}/icon-foreground.png`);
// Splash: the rounded brand mark centred on navy (both light and dark mode use the brand background, so no white flash).
const splash = svg(`<rect width="2732" height="2732" fill="${NAVY}"/><g transform="translate(1110 1110) scale(1)">${`<rect width="512" height="512" rx="118" fill="#102D51"/>` + glyph}</g>`, 2732);
await sharp(splash, { density: 300 }).resize(2732, 2732).png().toFile(`${out}/splash.png`);
await sharp(splash, { density: 300 }).resize(2732, 2732).png().toFile(`${out}/splash-dark.png`);
// Android monochrome status-bar icon (white glyph on transparent), used for notifications.
await sharp(svg(`<g fill="#FFFFFF"><path d="M148 150h216c12 0 19 14 11 24L232 338h132v48H148c-12 0-19-14-11-24l143-164H148v-48Z"/><path d="M315 126h72l-42 58h48l-89 108 25-78h-48l34-88Z"/></g>`), { density: 600 }).resize(96, 96).png().toFile(`${out}/notification-icon.png`);
console.log("brand sources written to", out);
