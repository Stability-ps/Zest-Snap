/**
 * pdf-lib's standard fonts (Helvetica) only encode WinAnsi (Windows-1252). Any other character makes
 * drawText/widthOfTextAtSize throw, which used to abort the whole PDF export. This maps text to what the
 * font can draw: look-alike substitutions first, emoji and other symbols removed, anything else → "?".
 */
const CP1252_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019,
  0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

const SUBSTITUTES: Record<string, string> = {
  "→": "->", "←": "<-", "↔": "<->", "⇒": "=>", "↑": "^", "↓": "v",
  "−": "-", "‐": "-", "‑": "-", "‒": "-", "―": "-",
  "≤": "<=", "≥": ">=", "≠": "!=", "≈": "~", "×": "x",
  "‛": "'", "′": "'", "″": '"', "‟": '"',
  "✓": "v", "✔": "v", "✕": "x", "✖": "x", "●": "•", "▪": "•", "◦": "•", "⁃": "-",
};

export function isWinAnsi(code: number) {
  return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || CP1252_EXTRAS.has(code);
}

export function toPdfSafeText(value: unknown): string {
  const input = String(value ?? "").normalize("NFC");
  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0)!;
    if (isWinAnsi(code)) out += ch;
    else if (SUBSTITUTES[ch] !== undefined) out += SUBSTITUTES[ch];
    // All whitespace/control characters (tabs, newlines, narrow/thin/zero-width spaces) become a plain space.
    else if (/\s/u.test(ch) || code < 0x20 || (code >= 0x7f && code < 0xa0) || (code >= 0x2000 && code <= 0x200f) || code === 0x202f || code === 0x205f || code === 0x2060 || code === 0xfeff) out += " ";
    // Emoji, pictographs, variation selectors and joiners carry no meaning in a text summary: drop them.
    else if (/\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Variation_Selector}/u.test(ch) || code === 0x200d || (code >= 0x1f1e6 && code <= 0x1f1ff)) continue;
    else {
      // Accented letters outside Latin-1 (e.g. "ő") fall back to their base letter; everything else is "?".
      const base = ch.normalize("NFD").replace(/\p{M}/gu, "");
      out += base && [...base].every((c) => isWinAnsi(c.codePointAt(0)!)) ? base : "?";
    }
  }
  return out.replace(/ {2,}/g, " ").trim();
}
