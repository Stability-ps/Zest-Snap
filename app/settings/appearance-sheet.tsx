"use client";
import { Check, ScanLine, RotateCcw } from "lucide-react";
import { ACCENTS } from "@/lib/appearance/palette";
import { THEME_MODES, type ThemeMode } from "@/lib/appearance/preferences";
import { resetAppearance, setAppearance } from "@/lib/appearance/client";
import { useAppearance } from "@/lib/appearance/use-appearance";
import { appearanceStrings as t } from "@/lib/appearance/strings";

/** Miniature screen drawn in the given scheme, independent of the page's current theme. */
function ModeThumb({ mode }: { mode: ThemeMode }) {
  return (
    <span className={"appearanceThumb " + mode} aria-hidden="true">
      <span className="appearanceThumbHalf light"><i /><b /><b /></span>
      <span className="appearanceThumbHalf dark"><i /><b /><b /></span>
    </span>
  );
}

/** Settings › Appearance. Every choice applies immediately on this device; signed-in accounts sync it. */
export default function AppearanceSheet({ owner, signedIn, onMessage, showReset = true }: { owner: string | null; signedIn: boolean; onMessage: (m: string) => void; showReset?: boolean }) {
  const appearance = useAppearance();
  return (
    <div className="appearanceSheet">
      <fieldset className="appearanceGroup">
        <legend>{t.modeHeading}</legend>
        <div className="appearanceModes">
          {THEME_MODES.map((mode) => (
            <label key={mode} className={"appearanceMode" + (appearance.mode === mode ? " selected" : "")}>
              <input type="radio" name="appearance-mode" value={mode} checked={appearance.mode === mode} onChange={() => setAppearance({ mode }, owner)} />
              <ModeThumb mode={mode} />
              <span className="appearanceModeCopy">
                <b>{t.modes[mode].label}</b>
                <small>{t.modes[mode].hint}</small>
              </span>
              <span className="appearanceTick" aria-hidden="true">{appearance.mode === mode && <Check />}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="appearanceGroup">
        <legend>{t.accentHeading}</legend>
        <div className="appearanceSwatches">
          {ACCENTS.map((accent) => {
            const selected = appearance.accent === accent.id;
            return (
              <label key={accent.id} className={"appearanceSwatch" + (selected ? " selected" : "")} title={t.accents[accent.id]}>
                <input
                  type="radio"
                  name="appearance-accent"
                  value={accent.id}
                  checked={selected}
                  aria-label={t.accents[accent.id]}
                  onChange={() => setAppearance({ accent: accent.id }, owner)}
                />
                <span className="appearanceSwatchDot" style={{ background: accent.hex }} aria-hidden="true">{selected && <Check />}</span>
                <span className="appearanceSwatchName">{t.accents[accent.id]}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <section className="appearanceGroup" aria-labelledby="appearance-preview-title">
        <h3 id="appearance-preview-title" className="appearanceLegend">{t.previewHeading}</h3>
        <div className="appearancePreview" aria-hidden="true">
          <div className="appearancePreviewHeader">
            <span className="brand">Zest <span>Snap</span></span>
            <span className="appearancePreviewPill">{t.modes[appearance.mode].label}</span>
          </div>
          <span className="appearancePreviewScan"><ScanLine size={17} /> {t.previewScan}</span>
          <div className="appearancePreviewTask">
            <span className="appearancePreviewCheck"><Check /></span>
            <span><b>{t.previewTaskTitle}</b><small>{t.previewTaskMeta}</small></span>
          </div>
          <div className="appearancePreviewProgress">
            <small>{t.previewProgress}</small>
            <span><i style={{ width: "75%" }} /></span>
          </div>
        </div>
      </section>

      {showReset && <div className="appearanceFooter">
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
        <small>{t.resetHint} · {signedIn ? t.savedSignedIn : t.savedDevice}</small>
      </div>}
    </div>
  );
}
