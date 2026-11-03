"use client";

import { useEffect, useRef } from "react";

import { CampaignError } from "@/lib/campaign/api";

/** The GA4 events in the agreed metrics list; session_start and page_view are collected by GA itself. */
export type CampaignEvent =
  | "campaign_landing_viewed"
  | "campaign_cta_clicked"
  | "login_screen_viewed"
  | "otp_requested"
  | "otp_request_failed"
  | "login"
  | "login_failed"
  | "email_capture_completed"
  | "design_gallery_viewed"
  | "design_selected"
  | "customization_started"
  | "customization_validation_failed"
  | "customization_completed"
  | "moderation_submitted"
  | "moderation_completed"
  | "preview_viewed"
  | "preview_edit_clicked"
  | "download_initiated"
  | "file_download"
  | "share"
  | "entry_submission_attempted"
  | "entry_submitted"
  | "entry_submission_failed"
  | "entry_window_blocked"
  | "thank_you_viewed";

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

/** gtag.js only reads `arguments` objects from the queue; it silently ignores arrays, so no rest spread here. */
function gtag(..._args: unknown[]) {
  // eslint-disable-next-line prefer-rest-params
  window.dataLayer!.push(arguments);
}

/**
 * Starts GA on first use, since a screen's effects run before the layout's. False when it must stay
 * off: no measurement ID in this build, or the staff admin pages, which share the campaign layout.
 */
function start() {
  const id = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  if (!id || window.location.pathname.includes("/user-campaign/admin")) return false;
  if (!window.dataLayer) {
    window.dataLayer = [];
    gtag("js", new Date());
    gtag("config", id);
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
    document.head.append(script);
  }
  return true;
}

/** Never pass the phone, email, OTP or the visitor's text: only fixed values belong in `params`. */
export function track(event: CampaignEvent, params: Record<string, string> = {}) {
  if (start()) gtag("event", event, params);
}

/** A fixed value safe to report: the server's code, never its message. */
export const failureReason = (err: unknown) => (err instanceof CampaignError ? err.code.toLowerCase() : "unknown");

/** Fires once `when` holds, and only once per mount, so re-renders and Strict Mode don't add views. */
export function useTrackOnce(event: CampaignEvent, when = true) {
  const fired = useRef(false);
  useEffect(() => {
    if (!when || fired.current) return;
    fired.current = true;
    track(event);
  }, [event, when]);
}

/** useTrackOnce for server components. */
export function TrackOnce({ event }: { event: CampaignEvent }) {
  useTrackOnce(event);
  return null;
}

/** Starts GA on every campaign page, so a page that sends no event of its own still counts its session. */
export function CampaignAnalytics() {
  useEffect(() => void start(), []);
  return null;
}
