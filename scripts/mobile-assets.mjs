// Rasterise the approved Zest Snap calendar/check brand for native stores and splash screens.
// Keep this in sync with public/icons/zest-icon.svg; this script changes sizing/masking, not the brand.
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const NAVY = "#0B1F3B";
const TEAL = "#00C6A7";
const glyph = `
  <path d="M151 152c0-19 15-34 34-34h142c19 0 34 15 34 34v36H151v-36Z" fill="${TEAL}"/>
  <rect x="151" y="173" width="210" height="221" rx="34" fill="#fff"/>
  <rect x="189" y="230" width="134" height="24" rx="12" fill="${NAVY}"/>
  <rect x="189" y="282" width="99" height="24" rx="12" fill="${TEAL}"/>
  <path d="M330 318l18 18 38-46" fill="none" stroke="${TEAL}" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>
`;
const svg = (body, size = 512) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">${body}</svg>`);
const out = "mobile/assets";
mkdirSync(out, { recursive: true });

// Full-bleed store icon. Android/Samsung applies its own icon mask, so do not bake another rounded square into the foreground.
await sharp(svg(`<rect width="512" height="512" fill="${NAVY}"/>${glyph}`), { density: 1200 })
  .resize(1024, 1024).flatten({ background: NAVY }).png().toFile(`${out}/icon-only.png`);

// Adaptive icon: navy background + a larger transparent calendar foreground.
// 0.82 removes the excessive padding visible on Samsung while remaining inside the adaptive safe zone.
await sharp(svg(`<rect width="512" height="512" fill="${NAVY}"/>`)).resize(1024, 1024).png().toFile(`${out}/icon-background.png`);
await sharp(svg(`<g transform="translate(256 256) scale(0.82) translate(-256 -256)">${glyph}</g>`), { density: 1200 })
  .resize(1024, 1024).png().toFile(`${out}/icon-foreground.png`);

// Splash: same approved calendar artwork directly on navy. No extra rounded tile/container;
// Android already controls the launch-icon mask and the extra tile caused the visible corner artefacts.
const splashGlyph = `<g transform="translate(1110 1110)">${glyph}</g>`;
const splash = svg(`<rect width="2732" height="2732" fill="${NAVY}"/>${splashGlyph}`, 2732);
await sharp(splash, { density: 300 }).resize(2732, 2732).png().toFile(`${out}/splash.png`);
await sharp(splash, { density: 300 }).resize(2732, 2732).png().toFile(`${out}/splash-dark.png`);

// Android monochrome notification icon.
await sharp(svg(`<g fill="#FFFFFF"><path d="M151 152c0-19 15-34 34-34h142c19 0 34 15 34 34v36H151v-36Z"/><rect x="151" y="173" width="210" height="221" rx="34"/><path d="M330 318l18 18 38-46" fill="none" stroke="#FFFFFF" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/></g>`), { density: 600 })
  .resize(96, 96).png().toFile(`${out}/notification-icon.png`);

console.log("brand sources written to", out);
