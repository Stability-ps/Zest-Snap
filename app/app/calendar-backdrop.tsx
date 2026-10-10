/**
 * Soft illustrated scene drawn behind month calendars (Planner and the To-do date picker): a desk with a coffee
 * mug, a phone snapping a notice, a little plant and sticky notes. Decorative only (aria-hidden, no pointer
 * events). Every colour is a theme token, so it follows Light/Dark and the chosen accent; styles in globals.css.
 */
export default function CalendarBackdrop() {
  return (
    <svg className="calendarBackdrop" viewBox="0 0 360 150" preserveAspectRatio="xMidYMax meet" aria-hidden="true" focusable="false">
      {/* desk */}
      <path className="cbDesk" d="M0 132 L40 104 H330 L360 132 V150 H0 Z" />
      <path className="cbDeskEdge" d="M0 132 H360 V138 H0 Z" />

      {/* mug with steam */}
      <path className="cbSteam" d="M70 58 c-6 -8 6 -12 0 -22 M80 60 c-6 -9 7 -13 0 -24" />
      <path className="cbMug" d="M58 70 h34 v30 a10 10 0 0 1 -10 10 h-14 a10 10 0 0 1 -10 -10 Z" />
      <path className="cbMugHandle" d="M92 76 h4 a8 8 0 0 1 0 16 h-4" />
      <ellipse className="cbMugTop" cx="75" cy="70" rx="17" ry="3.5" />

      {/* sticky notes */}
      <rect className="cbNote" x="118" y="90" width="30" height="24" rx="3" transform="rotate(-8 133 102)" />
      <rect className="cbNote b" x="132" y="94" width="30" height="24" rx="3" transform="rotate(6 147 106)" />
      <path className="cbNoteLine" d="M138 102 h16 M138 108 h11" transform="rotate(6 147 106)" />

      {/* phone snapping a notice */}
      <g transform="rotate(-6 250 70)">
        <rect className="cbPhone" x="214" y="22" width="72" height="104" rx="12" />
        <rect className="cbScreen" x="220" y="30" width="60" height="88" rx="8" />
        <rect className="cbPaper" x="232" y="46" width="36" height="46" rx="3" />
        <path className="cbPaperLine" d="M238 56 h22 M238 63 h16 M238 70 h20 M238 77 h12" />
        <path className="cbScan" d="M227 46 v-7 h7 M273 39 h7 v7 M280 92 v7 h-7 M234 99 h-7 v-7" />
        <rect className="cbShutter" x="241" y="104" width="18" height="6" rx="3" />
      </g>

      {/* plant */}
      <path className="cbLeaf" d="M318 80 c-14 -6 -16 -22 -12 -30 c10 4 16 16 12 30 Z" />
      <path className="cbLeaf b" d="M320 80 c10 -10 24 -10 30 -4 c-8 8 -20 10 -30 4 Z" />
      <path className="cbLeaf" d="M319 82 c-2 -16 6 -30 14 -34 c4 12 -2 26 -14 34 Z" />
      <path className="cbPot" d="M304 82 h30 l-4 26 h-22 Z" />
    </svg>
  );
}
