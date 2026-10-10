/**
 * Small illustrations for empty states (Planner, To-do, Reminders, Shared, History, Home Today), drawn in the same
 * soft style as the calendar backdrop. Theme tokens only (styles in globals.css), so they follow Light/Dark and the
 * accent. Decorative: the visible text beside them carries the meaning.
 */
export type EmptyArtKind = "calendar" | "todo" | "bell" | "people" | "history";

export default function EmptyArt({ kind, size = "md" }: { kind: EmptyArtKind; size?: "sm" | "md" }) {
  return (
    <svg className={"emptyArt " + size} viewBox="0 0 120 90" aria-hidden="true" focusable="false">
      <ellipse className="eaShadow" cx="60" cy="82" rx="40" ry="5" />
      {kind === "calendar" && (
        <g>
          <rect className="eaCard" x="28" y="16" width="64" height="58" rx="12" />
          <path className="eaHead" d="M28 28 a12 12 0 0 1 12 -12 h40 a12 12 0 0 1 12 12 v6 h-64 Z" />
          <rect className="eaRing" x="42" y="10" width="6" height="14" rx="3" />
          <rect className="eaRing" x="72" y="10" width="6" height="14" rx="3" />
          <rect className="eaDot" x="38" y="42" width="10" height="9" rx="2.5" />
          <rect className="eaDot" x="55" y="42" width="10" height="9" rx="2.5" />
          <rect className="eaDot accent" x="72" y="42" width="10" height="9" rx="2.5" />
          <rect className="eaDot" x="38" y="56" width="10" height="9" rx="2.5" />
          <rect className="eaDot" x="55" y="56" width="10" height="9" rx="2.5" />
          <circle className="eaSun" cx="94" cy="20" r="9" />
          <path className="eaRay" d="M94 4v4 M94 32v4 M78 20h4 M106 20h4 M83 9l3 3 M102 28l3 3 M105 9l-3 3 M86 28l-3 3" />
        </g>
      )}
      {kind === "todo" && (
        <g>
          <rect className="eaCard" x="30" y="10" width="60" height="66" rx="10" />
          <rect className="eaClip" x="48" y="5" width="24" height="10" rx="4" />
          <circle className="eaCheck done" cx="44" cy="32" r="6" />
          <path className="eaTick" d="M41 32 l2.5 2.5 l4.5 -5" />
          <rect className="eaLine" x="56" y="29" width="24" height="6" rx="3" />
          <circle className="eaCheck done" cx="44" cy="49" r="6" />
          <path className="eaTick" d="M41 49 l2.5 2.5 l4.5 -5" />
          <rect className="eaLine" x="56" y="46" width="18" height="6" rx="3" />
          <circle className="eaCheck" cx="44" cy="66" r="6" />
          <rect className="eaLine faint" x="56" y="63" width="22" height="6" rx="3" />
        </g>
      )}
      {kind === "bell" && (
        <g>
          <path className="eaCard" d="M60 14 c-15 0 -24 11 -24 25 v14 l-7 9 h62 l-7 -9 v-14 c0 -14 -9 -25 -24 -25 Z" />
          <rect className="eaRing" x="56" y="8" width="8" height="9" rx="4" />
          <path className="eaHead" d="M51 66 a9 9 0 0 0 18 0 Z" />
          <path className="eaRay" d="M24 30 c-4 6 -4 14 0 20 M96 30 c4 6 4 14 0 20 M17 25 c-6 9 -6 21 0 30 M103 25 c6 9 6 21 0 30" />
          <circle className="eaBadge" cx="80" cy="22" r="7" />
        </g>
      )}
      {kind === "people" && (
        <g>
          <circle className="eaCard" cx="42" cy="34" r="12" />
          <path className="eaCard" d="M20 72 c0 -14 10 -22 22 -22 s22 8 22 22 Z" />
          <circle className="eaHeadFill" cx="78" cy="30" r="13" />
          <path className="eaHeadFill" d="M54 72 c0 -16 11 -25 24 -25 s24 9 24 25 Z" />
          <circle className="eaBadge" cx="96" cy="20" r="7" />
          <path className="eaTickOn" d="M93 20 l2 2 l4 -4" />
        </g>
      )}
      {kind === "history" && (
        <g>
          <rect className="eaCard" x="34" y="22" width="46" height="54" rx="8" transform="rotate(-8 57 49)" />
          <rect className="eaCard" x="42" y="16" width="46" height="56" rx="8" />
          <rect className="eaLine" x="50" y="28" width="28" height="5" rx="2.5" />
          <rect className="eaLine" x="50" y="38" width="20" height="5" rx="2.5" />
          <rect className="eaLine faint" x="50" y="48" width="24" height="5" rx="2.5" />
          <path className="eaScan" d="M38 18 v-7 h7 M85 11 h7 v7 M92 70 v7 h-7 M45 77 h-7 v-7" />
        </g>
      )}
    </svg>
  );
}
