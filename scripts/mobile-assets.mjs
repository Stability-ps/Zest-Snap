// Generates native source assets from the APPROVED Zest Snap brand pack identity.
// Source of truth: the scan-frame + calendar/page mark. The retired standalone Z/lightning mark must never be generated here.
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const NAVY = "#0B1F3B";
const out = "mobile/assets";
mkdirSync(out, { recursive: true });

// Approved scan/calendar mark, simplified only for rasterisation into native icon layers.
const coreMark = `
  <rect x="116" y="116" width="280" height="280" rx="72" fill="#FFFFFF"/>
  <path d="M116 210h280v-34c0-33-27-60-60-60H176c-33 0-60 27-60 60v34Z" fill="#F8FAFC"/>
  <rect x="166" y="174" width="180" height="158" rx="28" fill="#FFFFFF"/>
  <rect x="166" y="174" width="180" height="46" rx="18" fill="#0B1F3B"/>
  <rect x="195" y="154" width="16" height="48" rx="8" fill="#B8C4D3"/>
  <rect x="301" y="154" width="16" height="48" rx="8" fill="#B8C4D3"/>
  <path d="M292 116h44c33 0 60 27 60 60v44l-104-104Z" fill="#00C6A7"/>
  <path d="M292 116v72c0 18 14 32 32 32h72L292 116Z" fill="#00C6A7"/>
  <rect x="198" y="246" width="32" height="32" rx="6" fill="#CBD5E1"/>
  <rect x="240" y="246" width="32" height="32" rx="6" fill="#CBD5E1"/>
  <rect x="282" y="246" width="32" height="32" rx="6" fill="#0EA5E9"/>
  <rect x="198" y="288" width="32" height="32" rx="6" fill="#CBD5E1"/>
  <rect x="240" y="288" width="32" height="32" rx="6" fill="#CBD5E1"/>
  <rect x="282" y="288" width="32" height="32" rx="6" fill="#0070F3"/>
`;
const scanFrame = `
  <path d="M84 150v-34c0-18 14-32 32-32h34M362 84h34c18 0 32 14 32 32v34M428 362v34c0 18-14 32-32 32h-34M150 428h-34c-18 0-32-14-32-32v-34" fill="none" stroke="#FFFFFF" stroke-width="22" stroke-linecap="round"/>
`;
const mark = coreMark + scanFrame;
const svg = (body, size = 512) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">${body}</svg>`);

await sharp(svg(`<rect width="512" height="512" fill="${NAVY}"/>${mark}`), { density: 1200 })
  .resize(1024, 1024).flatten({ background: NAVY }).png().toFile(`${out}/icon-only.png`);
await sharp(svg(`<rect width="512" height="512" fill="${NAVY}"/>`)).resize(1024, 1024).png().toFile(`${out}/icon-background.png`);
await sharp(svg(`<g transform="translate(256 256) scale(0.90) translate(-256 -256)">${mark}</g>`), { density: 1200 })
  .resize(1024, 1024).png().toFile(`${out}/icon-foreground.png`);

// Splash keeps the same calendar/page identity but drops the outer scan-frame brackets. A larger mark with a
// soft teal glow and the wordmark beneath, all inside the centre ~1200px that stays visible when iOS
// aspect-fills this square onto a portrait phone. Generated PNGs are committed, so the font only matters
// when this script is re-run (Inter, falling back to the system sans).
const splash = svg(`
  <defs>
    <radialGradient id="glow" cx="1366" cy="1250" r="980" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#00C6A7" stop-opacity="0.22"/>
      <stop offset="0.45" stop-color="#00C6A7" stop-opacity="0.07"/>
      <stop offset="1" stop-color="#00C6A7" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="2732" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#0B1F3B"/>
      <stop offset="1" stop-color="#071528"/>
    </linearGradient>
    <filter id="lift" x="-30%" y="-30%" width="160%" height="170%">
      <feDropShadow dx="0" dy="28" stdDeviation="34" flood-color="#000000" flood-opacity="0.42"/>
    </filter>
  </defs>
  <rect width="2732" height="2732" fill="url(#bg)"/>
  <rect width="2732" height="2732" fill="url(#glow)"/>
  <g filter="url(#lift)" transform="translate(1366 1250) scale(1.7) translate(-256 -256)">${coreMark}</g>
  <text x="1366" y="1662" text-anchor="middle" font-family="Inter, 'SF Pro Display', Helvetica, Arial, sans-serif"
    font-size="132" font-weight="800" letter-spacing="-4" fill="#FFFFFF">Zest <tspan fill="#00C6A7">Snap</tspan></text>`, 2732);
await sharp(splash, { density: 300 }).resize(2732, 2732).png().toFile(`${out}/splash.png`);
await sharp(splash, { density: 300 }).resize(2732, 2732).png().toFile(`${out}/splash-dark.png`);

// Android status-bar notifications must be monochrome.
const notification = `
  <path d="M128 128h256v256H128z" fill="#FFFFFF"/>
  <path d="M80 150v-42c0-16 12-28 28-28h42M362 80h42c16 0 28 12 28 28v42M432 362v42c0 16-12 28-28 28h-42M150 432h-42c-16 0-28-12-28-28v-42" fill="none" stroke="#FFFFFF" stroke-width="24" stroke-linecap="round"/>
`;
await sharp(svg(notification), { density: 600 }).resize(96, 96).png().toFile(`${out}/notification-icon.png`);
// Google Play listing art: 512×512 icon (Play applies its own mask) and the 1024×500 feature graphic.
mkdirSync("mobile/store", { recursive: true });
await sharp(svg(`<rect width="512" height="512" fill="${NAVY}"/>${mark}`), { density: 1200 })
  .resize(512, 512).flatten({ background: NAVY }).png().toFile("mobile/store/play-icon-512.png");
const feature = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 500">
  <rect width="1024" height="500" fill="${NAVY}"/>
  <g transform="translate(70 70) scale(0.703)">${mark}</g>
  <text x="470" y="232" font-family="Helvetica, Arial, sans-serif" font-size="76" font-weight="700" fill="#FFFFFF">Zest <tspan fill="#00C6A7">Snap</tspan></text>
  <text x="472" y="300" font-family="Helvetica, Arial, sans-serif" font-size="26" fill="#CBD5E1">Anything with a date becomes actionable.</text>
</svg>`);
await sharp(feature, { density: 300 }).resize(1024, 500).flatten({ background: NAVY }).png().toFile("mobile/store/feature-graphic-1024x500.png");
console.log("approved Zest Snap scan/calendar brand sources written to", out, "and mobile/store");
