"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { CanPreview } from "@/components/campaign/CanPreview";
import { CircleButton, FieldError, PillButton } from "@/components/campaign/ui";
import { CampaignError, WINDOW_MESSAGE, campaignApi, type WindowState } from "@/lib/campaign/api";
import { renderCanPng } from "@/lib/campaign/canImage";
import { canFont } from "@/lib/campaign/fonts";
import { useCampaign } from "@/lib/campaign/store";

const FILE_NAME = "my-diet-coke-can.png";
const SAVE_FAILED = "Couldn’t save the image. Long-press the can to save it instead.";

/** Hands a file to the browser's download flow. */
function saveFile(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Preview — Figma 243:826. Download and share never submit an entry (PRD 7). */
export default function PreviewPage() {
  const router = useRouter();
  const { ready, session, designId, text, approvedText } = useCampaign();
  const [windowState, setWindowState] = useState<WindowState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // One key per preview visit: a retry or double tap reuses it, so it lands as one entry.
  const idempotencyKey = useRef(crypto.randomUUID());

  const clean = text.trim();
  const approved = Boolean(approvedText) && approvedText === clean;

  useEffect(() => {
    if (!ready) return;
    if (!session) router.replace("/campaign?login=1");
    else if (!approved) router.replace("/campaign/create");
  }, [ready, session, approved, router]);

  useEffect(() => {
    campaignApi.getWindowState().then(setWindowState, () => setWindowState(null));
  }, []);

  if (!ready || !session || !approved) return null;
  const token = session.token;

  const canFile = async () =>
    new File([await renderCanPng(designId, clean, canFont.style.fontFamily)], FILE_NAME, { type: "image/png" });

  async function download() {
    setSaving(true);
    setNotice(null);
    try {
      saveFile(await canFile());
      setNotice("Saved! Check your downloads.");
    } catch {
      setNotice(SAVE_FAILED);
    } finally {
      setSaving(false);
    }
  }

  async function share() {
    setSaving(true);
    setNotice(null);
    let file: File;
    try {
      file = await canFile();
    } catch {
      setNotice(SAVE_FAILED);
      setSaving(false);
      return;
    }
    const data = { files: [file], text: "Your Diet Coke energy. Ready for the group chat." };
    try {
      if (navigator.canShare?.(data)) {
        await navigator.share(data);
      } else {
        // No native file sharing (most desktops) — save it so they can post it themselves.
        saveFile(file);
        setNotice("Sharing isn’t supported here, so we saved it instead. Post it from your gallery!");
      }
    } catch (err) {
      // AbortError is the user closing the share sheet — not a failure.
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setNotice("Couldn’t open sharing. Try downloading your can instead.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      await campaignApi.submitEntry(token, { designId, text: clean, idempotencyKey: idempotencyKey.current });
      router.push("/campaign/success");
    } catch (err) {
      if (err instanceof CampaignError && err.code === "WINDOW_CLOSED") {
        setWindowState(await campaignApi.getWindowState());
        setError(err.message);
      } else {
        setError("We couldn’t submit your entry. Your design is saved — please try again.");
      }
      setSubmitting(false);
    }
  }

  const closed = windowState !== null && windowState !== "OPEN";

  return (
    <main className="flex h-dvh flex-col bg-white px-5 pt-4 pb-[max(43px,env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-between">
        <CircleButton label="Back to editing" onClick={() => router.push("/campaign/create")}>
          <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M14.5 6.5L9 12l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </CircleButton>
        <div className="flex gap-4">
          <CircleButton label="Download My Can" onClick={download} disabled={saving}>
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
          <CircleButton label="Share My Look" onClick={share} disabled={saving}>
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
        <h1 className="font-[family-name:var(--dc-serif)] text-2xl leading-[1.2] text-[#F40009]">
          It’s giving <em>iconic!</em>
        </h1>
        <p className="text-base leading-[1.2] text-[#8A8A8A]">
          Your main character moment won’t wait forever. Don’t let it slip!
        </p>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center py-6">
        <CanPreview designId={designId} text={clean} priority className="h-full max-h-[473px]" />
      </div>

      <div className="flex flex-col gap-2">
        <p aria-live="polite" className="text-center text-[11px] text-[#8A8A8A] empty:hidden">
          {notice}
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
