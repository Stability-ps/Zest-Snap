"use client";

import { useState, type FocusEvent } from "react";

/**
 * On phones the auth card tightens up once a text field is focused, so the action button stays above the
 * on-screen keyboard. It stays compact afterwards: changing the layout when focus leaves the field (as
 * pressing a button does, and Safari never focuses buttons) moves the button out from under the finger
 * and the tap is lost.
 */
export function useCompactAuthCard() {
  const [compact, setCompact] = useState(false);
  return {
    className: compact ? "authCard authCompact" : "authCard",
    onFocus: (e: FocusEvent<HTMLElement>) => {
      if (!compact && e.target instanceof HTMLInputElement) setCompact(true);
    },
  };
}
