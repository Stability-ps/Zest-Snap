/**
 * Zest Snap colour system: the single source for every theme colour.
 *
 * app/theme.css is generated from this file (`npm run theme:css`) and tests/appearance.test.ts fails if
 * the two drift apart or if any token pair drops below its WCAG contrast target. Components use the CSS
 * custom properties only, never raw colours.
 */

export const ACCENTS = [
  { id: "ocean", name: "Ocean Blue", hex: "#2788EF" },
  { id: "teal", name: "Teal", hex: "#079F91" },
  { id: "violet", name: "Violet", hex: "#8B5CF6" },
  { id: "rose", name: "Rose", hex: "#E66B91" },
  { id: "amber", name: "Amber", hex: "#DB9639" },
  { id: "slate", name: "Slate", hex: "#64748B" },
] as const;
export type AccentId = (typeof ACCENTS)[number]["id"];
export type Scheme = "light" | "dark";

/** Neutral and semantic tokens. Accent tokens are derived per accent by accentTokens(). */
export const NEUTRALS: Record<Scheme, Record<string, string>> = {
  light: {
    bg: "#f7fafc",
    "bg-tint": "#f7fffd",
    surface: "#ffffff",
    "surface-2": "#f8fafc",
    "surface-3": "#f1f5f9",
    "surface-4": "#e2e8f0",
    elevated: "#ffffff",
    "surface-glass": "rgb(255 255 255 / 0.94)",
    nav: "rgb(255 255 255 / 0.96)",
    text: "#10233f",
    "text-2": "#52667a",
    "text-3": "#5d6d85",
    "text-4": "#94a3b8",
    border: "#dce5ed",
    "border-strong": "#c9d6e2",
    divider: "#edf1f4",
    ink: "#0b1f3b",
    "ink-2": "#17365d",
    "on-ink": "#ffffff",
    hero: "#0b1f3b",
    "hero-2": "#12345c",
    "on-hero": "#ffffff",
    "on-hero-2": "#c9d6e5",
    "control-border": "#7b8a99",
    "control-off": "#b4c1cd",
    brand: "#00c6a7",
    "brand-display": "#009c84",
    "brand-text": "#087865",
    success: "#0a9c84",
    "success-text": "#087865",
    "success-soft": "#e7f8f3",
    "success-border": "#bce9df",
    warning: "#e8a600",
    "warning-text": "#95600b",
    "warning-soft": "#fff6df",
    "warning-border": "#f0d57d",
    danger: "#b42318",
    "danger-strong": "#a43f36",
    "danger-text": "#a43f36",
    "danger-soft": "#fff3f2",
    "danger-border": "#e8b8b3",
    info: "#1d8fe8",
    "info-text": "#0b62c4",
    "info-soft": "#eef6ff",
    overlay: "rgb(7 23 43 / 0.46)",
    "shadow-rgb": "11 31 59",
    "shadow-strength": "1",
    highlight: "rgb(255 255 255 / 0.96)",
    skeleton: "#edf1f4",
    "skeleton-shine": "#f8fafc",
    "cat-school": "#b45309",
    "cat-health": "#e11d48",
    "cat-work": "#2563eb",
    "cat-bills": "#c2410c",
    "cat-travel": "#0e7490",
    "cat-social": "#7c3aed",
  },
  dark: {
    bg: "#0e1114",
    "bg-tint": "#0e1114",
    surface: "#161a1f",
    "surface-2": "#1b2026",
    "surface-3": "#222830",
    "surface-4": "#2c333c",
    elevated: "#1e2329",
    "surface-glass": "rgb(22 26 31 / 0.94)",
    nav: "rgb(20 24 29 / 0.96)",
    text: "#edf1f5",
    "text-2": "#b8c3ce",
    "text-3": "#98a4b1",
    "text-4": "#6f7b88",
    border: "#2b323b",
    "border-strong": "#3b4550",
    divider: "#242a31",
    ink: "#edf1f5",
    "ink-2": "#d7dee6",
    "on-ink": "#0e1114",
    hero: "#15263b",
    "hero-2": "#1d3756",
    "on-hero": "#ffffff",
    "on-hero-2": "#bccbdb",
    "control-border": "#6f7b88",
    "control-off": "#4a5562",
    brand: "#2fd3b8",
    "brand-display": "#2fd3b8",
    "brand-text": "#4fdcc4",
    success: "#34c7a6",
    "success-text": "#5fd6bb",
    "success-soft": "#13302b",
    "success-border": "#21564c",
    warning: "#f2b544",
    "warning-text": "#f4c26a",
    "warning-soft": "#33280f",
    "warning-border": "#5d4917",
    danger: "#f0645a",
    "danger-strong": "#c4362d",
    "danger-text": "#ff8a80",
    "danger-soft": "#3a1a19",
    "danger-border": "#6a2c28",
    info: "#5aa9f5",
    "info-text": "#86c0f8",
    "info-soft": "#15283d",
    overlay: "rgb(0 0 0 / 0.62)",
    "shadow-rgb": "0 0 0",
    "shadow-strength": "2.2",
    highlight: "rgb(255 255 255 / 0.04)",
    skeleton: "#222830",
    "skeleton-shine": "#2c333c",
    "cat-school": "#fbbf24",
    "cat-health": "#fb7185",
    "cat-work": "#60a5fa",
    "cat-bills": "#fb923c",
    "cat-travel": "#22d3ee",
    "cat-social": "#a78bfa",
  },
};

/** Browser/OS chrome colour (meta theme-color) per resolved scheme. Light keeps the existing navy. */
export const THEME_COLOR: Record<Scheme, string> = { light: "#0B1F3B", dark: "#0e1114" };

type RGB = [number, number, number];
export function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as RGB;
}
export function rgbToHex([r, g, b]: RGB) {
  return "#" + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");
}
function channel(v: number) {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
export function luminance(hex: string) {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
/** WCAG 2.x contrast ratio. */
export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** Linear sRGB mix: weight 0 → a, 1 → b. */
export function mix(a: string, b: string, weight: number) {
  const [p, q] = [hexToRgb(a), hexToRgb(b)];
  return rgbToHex(p.map((v, i) => v + (q[i] - v) * weight) as RGB);
}
/** Moves `hex` toward `toward` in small steps until it reaches `ratio` against every background. */
function reach(hex: string, backgrounds: string[], ratio: number, toward: string) {
  let out = hex;
  for (let step = 0; step <= 100; step++) {
    out = mix(hex, toward, step / 100);
    if (backgrounds.every((bg) => contrast(out, bg) >= ratio)) return out;
  }
  return out;
}

/**
 * Accent tokens for one scheme. Contrast targets (WCAG 2.2 AA):
 *  - accent        icons, progress, toggles, dots, focus rings: ≥ 3:1 against cards and the page
 *  - accent-strong filled buttons and selected pills: their label (on-accent) ≥ 4.5:1
 *  - accent-text   links and coloured labels: ≥ 4.5:1 on cards, page and the accent-soft tint
 */
export function accentTokens(hex: string, scheme: Scheme) {
  const n = NEUTRALS[scheme];
  const base = hex.toLowerCase();
  const surfaces = [n.surface, n.bg, n["surface-2"], n.elevated];
  if (scheme === "light") {
    const accent = reach(base, surfaces, 3, "#000000");
    const strong = reach(base, ["#ffffff"], 4.5, "#000000");
    const soft = mix(base, "#ffffff", 0.9);
    const text = reach(base, [...surfaces, soft], 4.5, "#000000");
    return {
      accent,
      "accent-strong": strong,
      "accent-strong-hover": mix(strong, "#000000", 0.12),
      "on-accent": "#ffffff",
      "accent-text": text,
      "accent-soft": soft,
      "accent-wash": mix(base, "#ffffff", 0.95),
      "accent-border": mix(base, "#ffffff", 0.62),
      "accent-ring": mix(base, "#ffffff", 0.55),
      "accent-rgb": hexToRgb(base).join(" "),
    };
  }
  const accent = reach(base, surfaces, 3, "#ffffff");
  // Dark mode: keep white labels when the fill only needs a slight darkening to reach 4.5:1; otherwise
  // (Amber, Rose) keep the bright fill, which reads better on charcoal, and switch the label to near-black.
  const whiteFill = reach(base, ["#ffffff"], 4.5, "#000000");
  const useWhite = contrast(whiteFill, base) < 1.45 && contrast(whiteFill, n.surface) >= 3;
  const onAccent = useWhite ? "#ffffff" : n["on-ink"];
  const strong = useWhite ? whiteFill : reach(reach(base, [n.surface, n.bg], 3, "#ffffff"), [onAccent], 4.5, "#ffffff");
  const soft = mix(n.surface, base, 0.2);
  const text = reach(base, [...surfaces, soft], 4.5, "#ffffff");
  return {
    accent,
    "accent-strong": strong,
    "accent-strong-hover": mix(strong, "#ffffff", 0.1),
    "on-accent": onAccent,
    "accent-text": text,
    "accent-soft": soft,
    "accent-wash": mix(n.surface, base, 0.08),
    "accent-border": mix(n.surface, base, 0.45),
    "accent-ring": mix(n.surface, base, 0.6),
    "accent-rgb": hexToRgb(base).join(" "),
  };
}

function block(selector: string, tokens: Record<string, string>) {
  return `${selector} {\n${Object.entries(tokens).map(([k, v]) => `  --${k}: ${v};`).join("\n")}\n}\n`;
}

/**
 * Light is the default. Dark applies for data-theme="dark" (set before first paint by the boot script)
 * and, when JavaScript has not run at all, for a dark OS through prefers-color-scheme.
 */
export function buildThemeCss() {
  const dark = { ...NEUTRALS.dark };
  const out: string[] = [
    "/* GENERATED by `npm run theme:css` from lib/appearance/palette.ts. Do not edit by hand. */\n",
    block(":root", { ...NEUTRALS.light, ...accentTokens(ACCENTS[0].hex, "light") }) +
      ":root {\n  color-scheme: light;\n}\n",
    block(':root[data-theme="dark"]', { ...dark, ...accentTokens(ACCENTS[0].hex, "dark") }) +
      ':root[data-theme="dark"] {\n  color-scheme: dark;\n}\n',
    "@media (prefers-color-scheme: dark) {\n" +
      block(":root:not([data-theme])", { ...dark, ...accentTokens(ACCENTS[0].hex, "dark") }).replace(/^/gm, "  ") +
      "  :root:not([data-theme]) {\n    color-scheme: dark;\n  }\n}\n",
  ];
  for (const a of ACCENTS.slice(1)) {
    out.push(block(`:root[data-accent="${a.id}"]`, accentTokens(a.hex, "light")));
    out.push(block(`:root[data-theme="dark"][data-accent="${a.id}"]`, accentTokens(a.hex, "dark")));
  }
  return out.join("\n");
}
