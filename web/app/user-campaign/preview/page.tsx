"use client";

import { useCampaignRouter } from "@/lib/campaign/nav";
import { useEffect, useRef, useState } from "react";

import logo from "@/app/user-campaign/_assets/logo.png";

import { CanPreview } from "@/components/campaign/CanPreview";
import { PHOTO_PAGE, PhotoBackdrop } from "@/components/campaign/PhotoBackdrop";
import { CircleButton, FieldError, PillButton } from "@/components/campaign/ui";
import { failureReason, track, useTrackOnce } from "@/lib/campaign/analytics";
import {
  CampaignError,
  WINDOW_MESSAGE,
  campaignApi,
  errorMessage,
  isUnauthorized,
  type WindowState,
} from "@/lib/campaign/api";
import { renderCanPng } from "@/lib/campaign/canImage";
import { useDesigns } from "@/lib/campaign/useDesigns";
import { canFont } from "@/lib/campaign/fonts";
import { useCampaign } from "@/lib/campaign/store";

const FILE_NAME = "my-diet-coke-can.png";
/** How long the download button shows its tick after a download. */
const TICK_MS = 2000;

interface CanImage {
  file: File;
  url: string;
}

/** Hands an already-rendered file to the browser's download flow. */
function saveFile({ file, url }: CanImage) {
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  // The browser reports nothing back, so a download counts as successful once it is handed over.
  track("file_download", { download_outcome: "success" });
}

/**
 * Preview — Figma 518:6405, and 518:6976 from 1024px up. Download and share never submit an
 * entry (PRD 7). Web adds a back circle below them, as phones have, so the design can be edited.
 */
export default function PreviewPage() {
  const router = useCampaignRouter();
  const { ready, session, designId, text, approvedText, pendingEntry, update } = useCampaign();
  const { find } = useDesigns();
  const [windowState, setWindowState] = useState<WindowState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [image, setImage] = useState<CanImage | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const tickTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(tickTimer.current), []);

  const clean = text.trim();
  const approved = Boolean(approvedText) && approvedText === clean;
  useTrackOnce("preview_viewed", ready && Boolean(session) && approved);

  useEffect(() => {
    if (!ready) return;
    if (!session) router.replace("/?login=1");
    else if (!approved) router.replace("/user-campaign/create");
  }, [ready, session, approved, router]);

  useEffect(() => {
    campaignApi.getWindowState().then(setWindowState, () => setWindowState(null));
  }, []);

  // Render the PNG once per visit, up front. Share and download then run inside the
  // tap itself — iOS Safari refuses share() after a long await — and the finished
  // image replaces the layered preview, so a long-press saves the real thing.
  useEffect(() => {
    if (!ready || !approved) return;
    let url: string | null = null;
    let cancelled = false;
    renderCanPng(designId, clean, canFont.style.fontFamily).then(
      (blob) => {
        if (cancelled) return;
        const file = new File([blob], FILE_NAME, { type: "image/png" });
        url = URL.createObjectURL(file);
        setImage({ file, url });
      },
      () => !cancelled && setImageFailed(true),
    );
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [ready, approved, designId, clean]);

  // Until the saved journey is read, show the backdrop rather than a blank page.
  if (!ready || !session || !approved)
    return (
      <main className={PHOTO_PAGE}>
        <PhotoBackdrop />
      </main>
    );

  function download() {
    if (!image) return;
    track("download_initiated");
    saveFile(image);
    // The icon turns into a tick for a moment instead of showing a message.
    setDownloaded(true);
    clearTimeout(tickTimer.current);
    tickTimer.current = setTimeout(() => setDownloaded(false), TICK_MS);
  }

  function share() {
    if (!image) return;
    setNotice(null);
    const data = { files: [image.file], text: "Your Diet Coke energy. Ready for the group chat." };
    if (!navigator.canShare?.(data)) {
      // No native file sharing (most desktops) — save it so they can post it themselves.
      saveFile(image);
      setNotice("Sharing isn’t supported here, so we saved it instead. Post it from your gallery!");
      return;
    }
    navigator.share(data).then(
      () => track("share"),
      (err: unknown) => {
        // AbortError is the user closing the share sheet — not a failure, and the sheet did open.
        if (err instanceof DOMException && err.name === "AbortError") track("share");
        else setNotice("Couldn’t open sharing. Try downloading your can instead.");
      },
    );
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    const resumable = pendingEntry && pendingEntry.designId === designId && pendingEntry.text === clean;
    const key = resumable ? pendingEntry.key : crypto.randomUUID();
    // A retry reuses the key, so it stays the same logical attempt.
    if (!resumable) {
      update({ pendingEntry: { key, designId, text: clean } });
      track("entry_submission_attempted");
    }
    try {
      await campaignApi.submitEntry({ designId, text: clean, idempotencyKey: key });
      track("entry_submitted");
      update({ pendingEntry: null });
      router.push("/user-campaign/success");
    } catch (err) {
      if (err instanceof CampaignError && err.code === "WINDOW_CLOSED") track("entry_window_blocked");
      else track("entry_submission_failed", { failure_reason: failureReason(err) });
      if (isUnauthorized(err)) {
        // Dropping the session triggers the login redirect above; the can stays saved.
        update({ session: null });
        return;
      }
      if (err instanceof CampaignError && (err.code === "TEXT_REJECTED" || err.code === "TEXT_INVALID")) {
        // Withdrawing the approval sends them back to edit (the redirect above), where the popup explains.
        update({ approvedText: null, textRejected: true });
        return;
      }
      if (err instanceof CampaignError && err.code === "WINDOW_CLOSED") {
        setError(err.message);
        setWindowState(await campaignApi.getWindowState().catch(() => null));
      } else {
        setError(errorMessage(err, "We couldn’t submit your entry. Your design is saved — please try again."));
      }
      setSubmitting(false);
    }
  }

  const closed = windowState !== null && windowState !== "OPEN";

  return (
    <main className={`${PHOTO_PAGE} px-[max(20px,calc(50%-220px))] pt-4 lg:px-5`}>
      <PhotoBackdrop />

      {/* Web: download and share stack 130px down, 50px in, 16px apart, with the added back circle after them. */}
      <div
        data-actions
        className="relative flex items-center justify-between lg:absolute lg:top-[130px] lg:left-[50px] lg:flex-col-reverse lg:gap-4"
      >
        <CircleButton
          label="Back to editing"
          onClick={() => {
            track("preview_edit_clicked");
            router.push("/user-campaign/create");
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M14.5 6.5L9 12l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </CircleButton>
        <div className="flex gap-4 lg:flex-col">
          <CircleButton label={downloaded ? "Downloaded" : "Download My Can"} onClick={download} disabled={!image}>
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              aria-hidden="true"
              data-icon={downloaded ? "tick" : "download"}
              className={downloaded ? "animate-pop" : undefined}
            >
              <path
                d={downloaded ? "M5 12.5l4.5 4.5L19 7.5" : "M12 4v10m0 0l-4-4m4 4l4-4M5 15v3a1 1 0 001 1h12a1 1 0 001-1v-3"}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </CircleButton>
          <CircleButton label="Share My Look" onClick={share} disabled={!image}>
            <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M5 5l15 7-15 7 2.5-7L5 5zm2.5 7H13"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
            </svg>
          </CircleButton>
        </div>
      </div>

      {/*
        Figma: 191×474 at 179px, ending 122px above the screen's foot. The can fills that space:
        exactly 474px on the 775px design screen, larger on taller phones.
        Web: 249×619 from 126px down on the 900px screen, with its shadow 12px under it.
      */}
      <div className="absolute top-[179px] left-1/2 h-[calc(100dvh-301px)] -translate-x-1/2 lg:top-[14dvh] lg:left-1/4 lg:h-[68.78dvh]">
        {image ? (
          // A blob URL, so next/image's optimiser has nothing to fetch; a plain img is right here.
          <img
            src={image.url}
            alt={`Your personalised Diet Coke can with ${find(designId).name} art and the text ${clean}`}
            className="h-full w-auto max-w-none"
          />
        ) : (
          <CanPreview designId={designId} text={clean} priority className="h-full" />
        )}
        <div
          data-shadow
          className="absolute top-[calc(100%+12px)] left-1/2 hidden h-[17px] w-[257px] -translate-x-1/2 rounded-[50%] bg-black/14 blur-[4px] lg:block"
          aria-hidden="true"
        />
      </div>

      {/*
        On phones the headline sits at the top and the button at the foot. On web they are one
        454px block centred in the right part: headline, copy, then the button 56px below.
      */}
      <div
        data-copy
        className="contents lg:absolute lg:top-1/2 lg:left-[76.67%] lg:flex lg:w-[454px] lg:-translate-x-1/2 lg:-translate-y-1/2 lg:flex-col lg:gap-14"
      >
        <div className="relative mx-auto mt-4 flex max-w-[316px] flex-col gap-2 text-center lg:mt-0 lg:max-w-none">
          {/* Figma's box is 33px: the DM Serif ascent overflows the 28.8px line height. */}
          <h1 className="font-[family-name:var(--dc-serif)] text-2xl leading-[33px] text-[#F40009] lg:text-[56px] lg:leading-[84px]">
            It’s giving <em>iconic!</em>
          </h1>
          <p className="text-base leading-[1.2] text-[#8A8A8A] lg:text-2xl">
            Your main character moment won’t wait forever. Don’t let it slip!
          </p>
        </div>

        {/* Figma: the button's bottom edge sits 43px above the screen's. */}
        <div className="absolute inset-x-[max(20px,calc(50%-220px))] bottom-[max(43px,env(safe-area-inset-bottom))] flex flex-col gap-2 lg:static">
          <p aria-live="polite" className="text-center text-[11px] text-[#8A8A8A] empty:hidden">
            {imageFailed ? "Couldn’t prepare your can image. Take a screenshot to keep it." : notice}
          </p>
          {closed && !error && <p className="text-center text-xs text-[#494949]">{WINDOW_MESSAGE[windowState]}</p>}
          {error && (
            <div className="text-center">
              <FieldError className="justify-center">{error}</FieldError>
            </div>
          )}
          <PillButton type="button" onClick={submit} busy={submitting} disabled={closed} className="!font-normal lg:mx-auto lg:h-14 lg:!font-semibold lg:w-[280px] lg:rounded-[26px] lg:text-base lg:leading-[19.2px]">
            Make It Happen
          </PillButton>
        </div>
      </div>
    </main>
  );
}
