"use client";

import Image from "next/image";
import { useCampaignRouter } from "@/lib/campaign/nav";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { CanPreview } from "@/components/campaign/CanPreview";
import { FieldError, LiveCheck, Modal, PillButton } from "@/components/campaign/ui";
import { errorMessage, isUnauthorized } from "@/lib/campaign/api";
import { DESIGNS } from "@/lib/campaign/designs";
import { useLiveModeration } from "@/lib/campaign/liveModeration";
import { useCampaign } from "@/lib/campaign/store";
import { MAX_TEXT_LENGTH, textLength, validateText } from "@/lib/campaign/text";

const CHECKER_DOWN = "Our message checker needs a moment. Your design is still here — please try again.";

/** Customising tool — Figma 243:872, with popups 243:936 (heads-up) and 243:1013 (rejected). */
export default function CreatePage() {
  const router = useCampaignRouter();
  const { ready, session, designId, text, approvedText, headsUpSeen, textRejected, update } = useCampaign();
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [rejected, setRejected] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Dropping the session triggers the login redirect below; design and text stay saved.
  const live = useLiveModeration(text, { approvedText, onUnauthorized: () => update({ session: null }) });

  useEffect(() => {
    if (ready && !session) router.replace("/user-campaign?login=1");
  }, [ready, session, router]);

  if (!ready || !session) return null;

  async function check(e: FormEvent) {
    e.preventDefault();
    const problem = validateText(text);
    if (problem) {
      setError(problem);
      return;
    }
    const clean = text.trim();
    // Moderation reruns only when the text changed since it last passed (PRD 6.3).
    if (clean === approvedText) {
      router.push("/user-campaign/preview");
      return;
    }
    // The live check may already have an answer (or a request under way); never ask twice.
    if (live.status === "rejected") {
      setRejected(true);
      return;
    }
    setChecking(true);
    setError(null);
    try {
      if ((await live.moderate(clean)) === "APPROVED") {
        update({ text: clean, approvedText: clean });
        router.push("/user-campaign/preview");
        return;
      }
      setRejected(true);
    } catch (err) {
      // Dropping the session triggers the login redirect above; design and text stay saved.
      if (isUnauthorized(err)) {
        update({ session: null });
        return;
      }
      // Fail safe: an unavailable checker never lets text through (PRD 6.3).
      setError(errorMessage(err, CHECKER_DOWN));
    }
    setChecking(false);
  }

  return (
    <main className="relative h-dvh overflow-hidden bg-white">
      <p className="pt-4 text-center text-[10px] leading-3 font-semibold tracking-[1.6px] text-[#F40009] uppercase">
        Diet Coke &nbsp;·&nbsp; Custom Edition
      </p>

      {/*
        Figma: 149×367 at 52px, leaving 16px above the 340px panel. The can fills that space,
        so it is exactly 367px tall on the 775px design screen and grows on taller phones.
      */}
      <div className="absolute top-[52px] left-1/2 h-[calc(100dvh-408px)] -translate-x-1/2">
        <CanPreview designId={designId} text={text.trim()} priority className="h-full" />
      </div>

      <form
        onSubmit={check}
        noValidate
        className="absolute inset-x-0 bottom-0 flex h-[340px] flex-col gap-3 rounded-t-[28px] border border-[#EDEDED] bg-white px-[19px] pt-5 pb-2 shadow-[0_-2px_12px_rgba(0,0,0,0.06)]"
      >
        <div className="flex flex-col gap-1">
          <label className="flex h-[59px] items-center gap-2 rounded-[14px] border-[0.5px] border-[#E8E8E8] px-4 py-3 focus-within:border-[#8A8A8A]">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[11px] leading-[13.2px] font-semibold text-[#F40009]">Enter Text</span>
              <input
                ref={inputRef}
                value={text}
                onChange={(e) => {
                  // Cap by code points (as textLength counts), so a surrogate pair is never split.
                  update({ text: Array.from(e.target.value).slice(0, MAX_TEXT_LENGTH).join("") });
                  setError(null);
                }}
                placeholder="Your name or a short message"
                autoComplete="off"
                enterKeyHint="done"
                aria-invalid={Boolean(error) || live.status === "rejected"}
                className="w-full bg-transparent text-base leading-[19.2px] text-[#111111] outline-none placeholder:text-[#B5B5B5]"
              />
            </span>
            <span className="text-xs leading-[14.4px] text-[#8A8A8A] tabular-nums" aria-live="polite">
              {textLength(text)}/{MAX_TEXT_LENGTH}
            </span>
          </label>
          {error ? <FieldError>{error}</FieldError> : <LiveCheck status={live.status} />}
        </div>

        {/* Figma "Frame 27": the grid and the button sit 8px apart, not the panel's 12px. */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-2">
            <p id="dc-vibe" className="font-[family-name:var(--dc-headline)] text-xs leading-[14.4px] font-bold text-[#111111]">
              Pick your vibe
            </p>
            <div
              role="radiogroup"
              aria-labelledby="dc-vibe"
              className="grid h-[132px] grid-cols-[repeat(3,minmax(0,115px))] justify-between gap-x-2 gap-y-2 overflow-y-auto [scrollbar-width:none]"
            >
              {DESIGNS.map((d) => {
                const selected = d.id === designId;
                return (
                  <button
                    key={d.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={d.name}
                    onClick={() => update({ designId: d.id })}
                    className={`relative h-20 overflow-hidden rounded-lg border bg-white transition ${
                      selected ? "border-black shadow-[0_3px_12px_rgba(0,0,0,0.08)]" : "border-[#E8E8E8]"
                    }`}
                  >
                    <Image
                      src={d.sticker}
                      alt=""
                      width={d.thumb.w}
                      height={d.thumb.h}
                      sizes="120px"
                      className="absolute max-w-none object-fill"
                      // Offsets are from Figma's 115px card; anchoring to the centre keeps them right when cards narrow.
                      style={{ left: `calc(50% + ${d.thumb.x - 57.5}px)`, top: d.thumb.y - 1, width: d.thumb.w, height: d.thumb.h }}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          <PillButton type="submit" busy={checking}>
            Check my vibe
          </PillButton>
        </div>
      </form>

      {!headsUpSeen && <HeadsUp onDone={() => update({ headsUpSeen: true })} />}
      {(rejected || textRejected) && (
        <Rejected
          onEdit={() => {
            setRejected(false);
            update({ textRejected: false });
            inputRef.current?.focus();
          }}
        />
      )}
    </main>
  );
}

function HeadsUp({ onDone }: { onDone: () => void }) {
  return (
    <Modal onClose={onDone} figmaTop={209} className="max-w-[334px] !pt-6">
      {(titleId) => (
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-4">
            <h2 id={titleId} className="pr-8 font-[family-name:var(--dc-headline)] text-xl leading-6 font-bold">
              Quick Heads-Up!
            </h2>
            <ol className="list-decimal pl-5 text-xs leading-[18px] text-[#8A8A8A]">
              <li>Your main-character moment starts at 10AM and ends at 10PM</li>
              <li>Not every entry makes the cut. Only a few DC Paglus win the daily draw.</li>
              <li>If you win you receive an email soon.</li>
            </ol>
          </div>
          <PillButton type="button" onClick={onDone}>
            Let’s Do This
          </PillButton>
        </div>
      )}
    </Modal>
  );
}

function Rejected({ onEdit }: { onEdit: () => void }) {
  return (
    <Modal onClose={onEdit} figmaTop={209}>
      {(titleId) => (
        <div className="flex flex-col gap-8">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex h-[84px] w-[84px] items-center justify-center rounded-full bg-[#F40009]/12">
              <div className="flex h-[58px] w-[58px] items-center justify-center rounded-full bg-[#F40009] shadow-[0_0_12px_rgba(245,0,9,0.35)]">
                <svg width="6" height="31" viewBox="0 0 6 31" aria-hidden="true">
                  <rect x="0.5" width="5" height="20" rx="2.5" fill="#fff" />
                  <circle cx="3" cy="28" r="3" fill="#fff" />
                </svg>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <h2 id={titleId} className="font-[family-name:var(--dc-headline)] text-xl leading-6 font-bold">
                Let’s keep it friendly
              </h2>
              <p className="text-xs leading-[18px] text-[#8A8A8A]">
                This content didn’t make the cut, let’s change it and try again
              </p>
            </div>
          </div>
          <PillButton type="button" onClick={onEdit}>
            Edit Text
          </PillButton>
        </div>
      )}
    </Modal>
  );
}
