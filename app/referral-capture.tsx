"use client";
import { useEffect } from "react";
import { captureReferral } from "@/lib/session";

/** Remembers an invite code from any landing URL (e.g. /?ref=…) until an account claims it. */
export default function ReferralCapture() {
  useEffect(() => captureReferral(), []);
  return null;
}
