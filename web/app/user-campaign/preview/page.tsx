"use client";

import { useCampaignRouter } from "@/lib/campaign/nav";
import { useEffect, useState } from "react";

import { CanPreview } from "@/components/campaign/CanPreview";
import { CircleButton, FieldError, PillButton } from "@/components/campaign/ui";
import {
  CampaignError,
  WINDOW_MESSAGE,
  campaignApi,
  errorMessage,
  isUnauthorized,
  type WindowState,
} from "@/lib/campaign/api";
import { renderCanPng } from "@/lib/campaign/canImage";
import { designById } from "@/lib/campaign/designs";
import { canFont } from "@/lib/campaign/fonts";
import { useCampaign } from "@/lib/campaign/store";

const FILE_NAME = "my-diet-coke-can.png";

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
}

/** Preview — Figma 243:826. Download and share never submit an entry (PRD 7). */
export default function PreviewPage() {
  const router = useCampaignRouter();
  const { ready, session, designId, text, approvedText, pendingEntry, update } = useCampaign();
  const [windowState, setWindowState] = useState<WindowState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [image, setImage] = useState<CanImage | null>(null);
  const [imageFailed, setImageFailed] = useState(false);

  const clean = text.trim();
  const approved = Boolean(approvedText) && approvedText === clean;

  useEffect(() => {
    if (!ready) return;
    if (!session) router.replace("/user-campaign?login=1");
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

  if (!ready || !session || !approved) return null;

  function download() {
    if (!image) return;
    saveFile(image);
    setNotice("Saved! Check your downloads.");
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
    navigator.share(data).catch((err: unknown) => {
      // AbortError is the user closing the share sheet — not a failure.
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setNotice("Couldn’t open sharing. Try downloading your can instead.");
      }
    });
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    const resumable = pendingEntry && pendingEntry.designId === designId && pendingEntry.text === clean;
    const key = resumable ? pendingEntry.key : crypto.randomUUID();
    if (!resumable) update({ pendingEntry: { key, designId, text: clean } });
    try {
      await campaignApi.submitEntry({ designId, text: clean, idempotencyKey: key });
      update({ pendingEntry: null });
      router.push("/user-campaign/success");
    } catch (err) {
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
    <main className="relative h-dvh overflow-hidden bg-white px-5 pt-4">
      <div className="flex items-center justify-between">
        <CircleButton label="Back to editing" onClick={() => router.push("/user-campaign/create")}>
          <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M14.5 6.5L9 12l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </CircleButton>
        <div className="flex gap-4">
          <CircleButton label="Download My Can" onClick={download} disabled={!image}>
            <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M12 4v10m0 0l-4-4m4 4l4-4M5 15v3a1 1 0 001 1h12a1 1 0 001-1v-3"
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

      <div className="mx-auto mt-4 flex max-w-[316px] flex-col gap-2 text-center">
        {/* Figma's box is 33px: the DM Serif ascent overflows the 28.8px line height. */}
        <h1 className="font-[family-name:var(--dc-serif)] text-2xl leading-[33px] text-[#F40009]">
          It’s giving <em>iconic!</em>
        </h1>
        <p className="text-base leading-[1.2] text-[#8A8A8A]">
          Your main character moment won’t wait forever. Don’t let it slip!
        </p>
      </div>

      {/*
        Figma: 191×473 at 179px, ending 123px above the screen's foot (32px above the button).
        The can fills that space: exactly 473px on the 775px design screen, larger on taller phones.
      */}
      <div className="absolute top-[179px] left-1/2 h-[calc(100dvh-302px)] -translate-x-1/2">
        {image ? (
          // A blob URL, so next/image's optimiser has nothing to fetch; a plain img is right here.
          <img
            src={image.url}
            alt={`Your personalised Diet Coke can with ${designById(designId).name} art and the text ${clean}`}
            className="h-full w-auto max-w-none"
          />
        ) : (
          <CanPreview designId={designId} text={clean} priority className="h-full" />
        )}
      </div>

      {/* Figma: the button's bottom edge sits 43px above the screen's. */}
      <div className="absolute inset-x-5 bottom-[max(43px,env(safe-area-inset-bottom))] flex flex-col gap-2">
        <p aria-live="polite" className="text-center text-[11px] text-[#8A8A8A] empty:hidden">
          {imageFailed ? "Couldn’t prepare your can image. Take a screenshot to keep it." : notice}
        </p>
        {closed && !error && <p className="text-center text-xs text-[#494949]">{WINDOW_MESSAGE[windowState]}</p>}
        <div className="text-center">
          <FieldError>{error}</FieldError>
        </div>
        <PillButton type="button" onClick={submit} busy={submitting} disabled={closed}>
          Make It Happen
        </PillButton>
      </div>
    </main>
  );
}
