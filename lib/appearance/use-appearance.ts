"use client";
import { useSyncExternalStore } from "react";
import { getAppearance, getServerAppearance, subscribeAppearance } from "./client";

/** Current appearance (mode, accent and the resolved light/dark scheme). Re-renders only on change. */
export function useAppearance() {
  return useSyncExternalStore(subscribeAppearance, getAppearance, getServerAppearance);
}
