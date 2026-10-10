"use client";
import type { CSSProperties } from "react";
import { Bell, CalendarDays, Check, CheckCircle2, Home, Moon, RotateCcw, ScanLine, Sun, SunMoon } from "lucide-react";
import { ACCENTS, NEUTRALS, accentTokens, type Scheme } from "@/lib/appearance/palette";
import { THEME_MODES, type ThemeMode } from "@/lib/appearance/preferences";
import { resetAppearance, setAppearance } from "@/lib/appearance/client";
import { useAppearance } from "@/lib/appearance/use-appearance";
import { appearanceStrings as t } from "@/lib/appearance/strings";

const MODE_ICONS: Record<ThemeMode, typeof Sun> = { light: Sun, dark: Moon, system: SunMoon };

/** CSS variables for a preview drawn in `scheme` with `hex`, using the same tokens the app itself uses. */
function previewVars(scheme: Scheme, hex: string): CSSProperties {
  const n = NEUTRALS[scheme];
  const a = accentTokens(hex, scheme);
  return {
    "--p-bg": n.bg,
    "--p-surface": n.surface,
    "--p-surface-2": n["surface-2"],
    "--p-border": n.border,
    "--p-text": n.text,
    "--p-text-3": n["text-3"],
    "--p-accent": a.accent,
    "--p-accent-strong": a["accent-strong"],
    "--p-on-accent": a["on-accent"],
    "--p-accent-soft": a["accent-soft"],
    "--p-accent-text": a["accent-text"],
  } as CSSProperties;
}

/** A miniature Zest Snap Home screen in the chosen mode and accent, independent of the page's own theme. */
function LivePreview({ scheme, hex }: { scheme: Scheme; hex: string }) {
  return (
    <div className={"appearancePhone " + scheme} style={previewVars(scheme, hex)} aria-hidden="true">
      <div className="appearancePhoneScreen">
        <div className="appearancePhoneTop">
          <span className="brand">
            Zest <span>Snap</span>
          </span>
          <span className="appearancePhonePill">✦ 13</span>
        </div>
        <small className="appearancePhoneHello">{t.previewHello}</small>
        <b className="appearancePhoneTitle">{t.previewTitle}</b>
        <span className="appearancePhoneScan">
          <ScanLine size={14} /> {t.previewScan}
        </span>
        <div className="appearancePhoneCard">
          <span className="appearancePhoneRow accent">
            <CalendarDays size={13} />
            <span>
              <b>{t.previewTaskTitle}</b>
              <small>{t.previewTaskMeta}</small>
            </span>
          </span>
          <span className="appearancePhoneRow">
            <CheckCircle2 size={13} />
            <span>
              <b>{t.previewTodoTitle}</b>
              <small>{t.previewTodoMeta}</small>
            </span>
          </span>
        </div>
        <div className="appearancePhoneNav">
          <span className="on">
            <Home size={14} />
          </span>
          <span>
            <CalendarDays size={14} />
          </span>
          <span>
            <CheckCircle2 size={14} />
          </span>
          <span>
            <Bell size={14} />
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Appearance picker: a live preview, Light / Dark / Automatic and the accent colour. Used in Settings ›
 * Appearance, the post-sign-up welcome step and (tone="dark") the first-run intro. Every choice applies
 * immediately on this device; signed-in accounts sync it.
 */
export default function AppearanceSheet({
  owner,
  signedIn,
  onMessage,
  showReset = true,
  tone = "app",
}: {
  owner: string | null;
  signedIn: boolean;
  onMessage: (m: string) => void;
  showReset?: boolean;
  tone?: "app" | "dark";
}) {
  const appearance = useAppearance();
  const current = ACCENTS.find((a) => a.id === appearance.accent) ?? ACCENTS[0];
  return (
    <div className={"appearanceSheet" + (tone === "dark" ? " onDark" : "")}>
      <LivePreview scheme={appearance.scheme} hex={current.hex} />

      <fieldset className="appearanceGroup">
        <legend>{t.modeHeading}</legend>
        <div className="appearanceSegment" role="radiogroup">
          {THEME_MODES.map((mode) => {
            const Icon = MODE_ICONS[mode];
            const selected = appearance.mode === mode;
            return (
              <label key={mode} className={"appearanceSegmentItem" + (selected ? " selected" : "")}>
                <input type="radio" name="appearance-mode" value={mode} checked={selected} onChange={() => setAppearance({ mode }, owner)} />
                <Icon size={17} aria-hidden="true" />
                <span>{t.modes[mode].label}</span>
              </label>
            );
          })}
        </div>
        <small className="appearanceHint">{t.modes[appearance.mode].hint}</small>
      </fieldset>

      <fieldset className="appearanceGroup">
        <legend>{t.accentHeading}</legend>
        <div className="appearanceGems">
          {ACCENTS.map((accent) => {
            const selected = appearance.accent === accent.id;
            return (
              <label key={accent.id} className={"appearanceGem" + (selected ? " selected" : "")} title={t.accents[accent.id]}>
                <input
                  type="radio"
                  name="appearance-accent"
                  value={accent.id}
                  checked={selected}
                  aria-label={t.accents[accent.id]}
                  onChange={() => setAppearance({ accent: accent.id }, owner)}
                />
                <span className="appearanceGemDot" style={{ "--gem": accent.hex } as CSSProperties} aria-hidden="true">
                  {selected && <Check />}
                </span>
              </label>
            );
          })}
        </div>
        <small className="appearanceHint strong">{t.accents[current.id]}</small>
      </fieldset>

      {showReset && (
        <div className="appearanceFooter">
          <button
            type="button"
            className="button alt"
            onClick={() => {
              resetAppearance(owner);
              onMessage(t.resetDone);
            }}
          >
            <RotateCcw size={17} /> {t.resetButton}
          </button>
          <small>
            {t.resetHint} · {signedIn ? t.savedSignedIn : t.savedDevice}
          </small>
        </div>
      )}
    </div>
  );
}
