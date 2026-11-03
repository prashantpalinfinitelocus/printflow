"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { track } from "@/lib/campaign/analytics";
import { campaignApi, isUnauthorized, type ModerationResult } from "@/lib/campaign/api";
import { validateText } from "@/lib/campaign/text";

/** Quiet time after the last keystroke before the text is sent to the checker. */
export const LIVE_CHECK_DELAY_MS = 600;

export type LiveStatus = "idle" | "checking" | "approved" | "rejected";

/**
 * Checks the text with the server's moderation (Vertex AI) while the user types, so they
 * learn straight away whether a line will be accepted instead of at "Check my vibe".
 *
 * It only ever asks the server for text that already passes the local rules, waits for a pause
 * in typing, and asks once per distinct text: the verdict (or the request still in flight) is
 * kept, and `moderate` hands the same one to the submit button. A failed request is forgotten so
 * the next try goes out again. The server re-moderates every entry regardless (PRD 6.3), so this
 * is feedback, never the gate.
 */
export function useLiveModeration(
  text: string,
  { approvedText, onUnauthorized }: { approvedText: string | null; onUnauthorized: () => void },
) {
  const verdicts = useRef(new Map<string, Promise<ModerationResult>>());
  const unauthorized = useRef(onUnauthorized);
  const [result, setResult] = useState<{ text: string; status: LiveStatus }>({ text: "", status: "idle" });

  useEffect(() => {
    unauthorized.current = onUnauthorized;
  });

  const moderate = useCallback((clean: string) => {
    let verdict = verdicts.current.get(clean);
    if (!verdict) {
      verdict = campaignApi.moderateText(clean);
      verdicts.current.set(clean, verdict);
      verdict.then(
        (result) => {
          track("moderation_submitted");
          track("moderation_completed", { moderation_status: result.toLowerCase() });
        },
        () => verdicts.current.delete(clean),
      );
    }
    return verdict;
  }, []);

  const clean = text.trim();
  const checkable = clean !== "" && validateText(text) === null;

  useEffect(() => {
    if (!checkable || clean === approvedText) return;
    let stale = false;
    const timer = setTimeout(
      () => {
        setResult({ text: clean, status: "checking" });
        moderate(clean).then(
          (verdict) => {
            if (!stale) setResult({ text: clean, status: verdict === "APPROVED" ? "approved" : "rejected" });
          },
          (err: unknown) => {
            if (stale) return;
            // An unavailable checker stays silent here; submitting asks again and explains.
            setResult({ text: clean, status: "idle" });
            if (isUnauthorized(err)) unauthorized.current();
          },
        );
      },
      verdicts.current.has(clean) ? 0 : LIVE_CHECK_DELAY_MS,
    );
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [clean, checkable, approvedText, moderate]);

  // A verdict belongs to the exact text it was given for; any edit hides it at once.
  let status: LiveStatus = "idle";
  if (checkable && clean === approvedText) status = "approved";
  else if (checkable && result.text === clean) status = result.status;

  return { status, moderate };
}
