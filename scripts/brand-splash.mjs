// Shared Zest Snap splash artwork: the approved calendar/page mark (without the scan-frame brackets), a soft teal
// glow and the wordmark on a navy gradient. Used by scripts/mobile-assets.mjs (native iOS/Android splash) and
// scripts/pwa-splash.mjs (iOS home-screen startup images), so every launch screen looks the same.

// Approved scan/calendar mark on a 512 grid (occupies 116..396), simplified for rasterisation.
export const CORE_MARK = `
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

/**
 * Splash SVG of any size. `mark` is the rendered width of the mark in pixels; the mark and wordmark are
 * centred as a group. All proportions are relative to `mark`, so every size has the same composition.
 */
export function splashSvg(width, height, mark) {
  const cx = width / 2;
  const cy = height / 2 - 0.2437 * mark; // group centre: mark above, wordmark below
  const r = (n) => Math.round(n * 100) / 100;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
  <defs>
    <radialGradient id="glow" cx="${r(cx)}" cy="${r(cy)}" r="${r(2.0588 * mark)}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#00C6A7" stop-opacity="0.22"/>
      <stop offset="0.45" stop-color="#00C6A7" stop-opacity="0.07"/>
      <stop offset="1" stop-color="#00C6A7" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="${height}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#0B1F3B"/>
      <stop offset="1" stop-color="#071528"/>
    </linearGradient>
    <filter id="lift" x="-30%" y="-30%" width="160%" height="170%">
      <feDropShadow dx="0" dy="28" stdDeviation="34" flood-color="#000000" flood-opacity="0.42"/>
    </filter>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <rect width="${width}" height="${height}" fill="url(#glow)"/>
  <g filter="url(#lift)" transform="translate(${r(cx)} ${r(cy)}) scale(${r(mark / 280)}) translate(-256 -256)">${CORE_MARK}</g>
  <text x="${r(cx)}" y="${r(cy + 0.8655 * mark)}" text-anchor="middle" font-family="Inter, 'SF Pro Display', Helvetica, Arial, sans-serif"
    font-size="${r(0.2773 * mark)}" font-weight="800" letter-spacing="${r((-4 / 476) * mark)}" fill="#FFFFFF">Zest <tspan fill="#00C6A7">Snap</tspan></text>
</svg>`);
}
