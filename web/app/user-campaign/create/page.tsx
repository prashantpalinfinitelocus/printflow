"use client";

import Image from "next/image";
import { useCampaignRouter } from "@/lib/campaign/nav";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";

import logo from "@/app/user-campaign/_assets/logo.png";

import { CanPreview } from "@/components/campaign/CanPreview";
import { FieldError, LiveCheck, Modal, PillButton } from "@/components/campaign/ui";
import { errorMessage, isUnauthorized } from "@/lib/campaign/api";
import { CATEGORIES, DESIGNS, type Category } from "@/lib/campaign/designs";
import { IMAGE_QUALITY } from "@/lib/campaign/imageQuality";
import { useLiveModeration } from "@/lib/campaign/liveModeration";
import { useCampaign } from "@/lib/campaign/store";
import { MAX_TEXT_LENGTH, textLength, validateText } from "@/lib/campaign/text";

const CHECKER_DOWN = "Our message checker needs a moment. Your design is still here — please try again.";

/**
 * Customising tool — Figma 243:872, with popups 243:936 (heads-up) and 243:1013 (rejected).
 * From 1024px up it is the web layout (356:1111): can and text card on a grey left panel,
 * category chips and a larger design grid on the right.
 */
export default function CreatePage() {
  const router = useCampaignRouter();
  const { ready, session, designId, text, approvedText, headsUpSeen, textRejected, update } = useCampaign();
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [category, setCategory] = useState<Category | "All">("All");
  const inputRef = useRef<HTMLInputElement>(null);
  // Dropping the session triggers the login redirect below; design and text stay saved.
  const live = useLiveModeration(text, { approvedText, onUnauthorized: () => update({ session: null }) });

  useEffect(() => {
    if (ready && !session) router.replace("/?login=1");
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
      {/* Web: the 768px grey panel behind the can and text card, with the small logo. */}
      <div
        data-web-panel
        className="absolute inset-y-0 left-0 hidden w-[53.33%] bg-[linear-gradient(to_bottom,#E8E8EA,#CECFD2)] lg:block"
        aria-hidden="true"
      >
        <Image quality={IMAGE_QUALITY} src={logo} alt="" sizes="60px" className="absolute top-10 left-10 h-[27px] w-[60px] object-contain" />
      </div>

      <p className="relative pt-4 text-center text-[10px] leading-3 font-semibold tracking-[1.6px] text-[#F40009] uppercase lg:absolute lg:top-12 lg:left-0 lg:w-[53.33%] lg:pt-0">
        Diet Coke &nbsp;·&nbsp; Custom Edition
      </p>

      {/*
        Figma: 149×367 at 52px, leaving 16px above the 340px panel. The can fills that space,
        so it is exactly 367px tall on the 775px design screen and grows on taller phones.
        Web: 614px tall from 93px down on the 900px screen, centred in the left panel. On a shorter
        laptop it shrinks to stay 32px above the text card, as in Figma, rather than overlap it.
      */}
      <div className="absolute top-[52px] left-1/2 h-[calc(100dvh-408px)] -translate-x-1/2 lg:top-[10.33dvh] lg:left-[26.67%] lg:h-[min(68.22dvh,calc(89.67dvh-208px))]">
        {/* Text the checker turned down never shows on the can, so it can't be screenshotted on the product. */}
        <CanPreview
          designId={designId}
          text={live.status === "rejected" || rejected || textRejected ? "" : text.trim()}
          priority
          className="h-full"
        />
      </div>

      {/* On web the panel's two halves are placed on the screen separately, so the form steps aside. */}
      <form
        onSubmit={check}
        noValidate
        className="absolute inset-x-0 bottom-0 flex h-[340px] flex-col gap-3 rounded-t-[28px] border border-[#EDEDED] bg-white px-[max(19px,calc(50%-221px))] pt-5 pb-2 shadow-[0_-2px_12px_rgba(0,0,0,0.06)] lg:contents"
      >
        {/* Web: Figma "Frame 110", the 420px text card 739px down, centred under the can; never closer than
            176px to the foot, so even the two-line rejection message stays 28px clear of it. */}
        <div className="flex flex-col gap-1 lg:absolute lg:top-[min(82.11dvh,calc(100dvh-176px))] lg:left-[26.67%] lg:w-[420px] lg:-translate-x-1/2 lg:gap-2">
          <div className="flex h-[59px] items-center gap-2 rounded-[14px] border-[0.5px] border-[#E8E8E8] px-4 py-3 focus-within:border-[#8A8A8A] lg:h-[87px] lg:gap-8 lg:rounded-2xl lg:border-0 lg:bg-white lg:px-6 lg:py-5">
            <label className="flex min-w-0 flex-1 flex-col gap-0.5 lg:gap-1">
              <span className="text-[11px] leading-[13.2px] font-semibold text-[#F40009] lg:text-xs lg:leading-[14.4px] lg:font-normal">
                Enter Text
              </span>
              <input
                ref={inputRef}
                value={text}
                onChange={(e) => {
                  // Cap by code points (as textLength counts), so a surrogate pair is never split.
                  update({ text: Array.from(e.target.value).slice(0, MAX_TEXT_LENGTH).join("") });
                  setError(null);
                }}
                onKeyDown={(e) => {
                  // On phones the keypad's Done only closes the keypad, so the text can be seen on the can;
                  // "Check my vibe" stays the way to the preview. Web (lg) keeps Enter as submit.
                  if (e.key === "Enter" && !window.matchMedia("(min-width: 1024px)").matches) {
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                }}
                placeholder="Your name or a short message"
                autoComplete="off"
                enterKeyHint="done"
                aria-invalid={Boolean(error) || live.status === "rejected"}
                // At 24px the web placeholder ran under the arrow button ("Your name or a short r"); 16px fits.
                className="w-full bg-transparent text-base leading-[19.2px] text-[#111111] outline-none placeholder:text-[#B5B5B5] lg:text-2xl lg:leading-[28.8px] lg:placeholder:text-base"
              />
            </label>
            <span className="text-xs leading-[14.4px] text-[#8A8A8A] tabular-nums lg:hidden" aria-live="polite">
              {textLength(text)}/{MAX_TEXT_LENGTH}
            </span>
            <button
              type="submit"
              aria-label="Check my text"
              disabled={checking}
              className="hidden h-[47px] w-[51px] shrink-0 items-center justify-center rounded-full bg-black text-white transition active:scale-95 disabled:opacity-50 lg:flex"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 16L16 8M9.5 8H16v6.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          <p className="hidden text-right text-xs leading-[14.4px] text-[#8A8A8A] tabular-nums lg:block" aria-live="polite">
            Max characters allowed {textLength(text)}/{MAX_TEXT_LENGTH}
          </p>
          {error ? <FieldError>{error}</FieldError> : <LiveCheck status={live.status} />}
        </div>

        {/*
          Figma "Frame 27": the grid and the button sit 8px apart, not the panel's 12px.
          Web ("Frame 90"): 80px in from the left panel and the right edge, 48px down, the
          button 56px off the foot; the grid scrolls in between.
        */}
        <div
          data-vibes
          className="flex flex-col gap-2 lg:absolute lg:top-12 lg:right-20 lg:bottom-14 lg:left-[calc(53.33%+80px)] lg:gap-4"
        >
          <div className="flex flex-col gap-2 lg:min-h-0 lg:flex-1 lg:gap-10">
            <div className="flex flex-col gap-2 lg:gap-6">
              <p
                id="dc-vibe"
                className="font-[family-name:var(--dc-headline)] text-xs leading-[14.4px] font-bold text-[#111111] lg:text-[32px] lg:leading-[38.4px]"
              >
                Pick your vibe
              </p>
              <div
                role="group"
                aria-label="Design categories"
                className="hidden flex-wrap gap-x-4 gap-y-3 lg:flex"
              >
                {(["All", ...CATEGORIES] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={c === category}
                    onClick={() => setCategory(c)}
                    // Figma draws the 1px outline inside the 54 × 39 chip; the padding gives that pixel back.
                    className={`shrink-0 rounded-[20px] border px-[15px] py-[9px] text-base leading-[19.2px] transition ${
                      c === category ? "border-black bg-black text-white" : "border-[#8A8A8A] text-black"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div
              role="radiogroup"
              aria-labelledby="dc-vibe"
              className="grid h-[132px] grid-cols-[repeat(3,minmax(0,115px))] justify-between gap-x-2 gap-y-2 overflow-y-auto [scrollbar-width:none] lg:h-auto lg:min-h-0 lg:grid-cols-[repeat(3,minmax(0,160px))] lg:content-start lg:justify-start lg:gap-x-4 lg:gap-y-[15px]"
            >
              {DESIGNS.map((d) => {
                const selected = d.id === designId;
                // The filter only exists on web: phones have no chips to undo it, so they always see every design.
                const filteredOut = category !== "All" && d.category !== category;
                return (
                  <button
                    key={d.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={d.name}
                    onClick={() => update({ designId: d.id })}
                    className={`relative h-20 overflow-hidden rounded-lg border bg-white transition lg:h-[140px] ${filteredOut ? "lg:hidden" : ""} ${
                      selected
                        ? "border-black shadow-[0_3px_12px_rgba(0,0,0,0.08)] lg:shadow-[0_3.6px_14.4px_rgba(0,0,0,0.08)]"
                        : "border-[#E8E8E8]"
                    }`}
                  >
                    <Image quality={IMAGE_QUALITY}
                      src={d.sticker}
                      alt=""
                      width={d.thumb.w}
                      height={d.thumb.h}
                      sizes="(min-width: 1024px) 160px, 120px"
                      className="dc-thumb object-fill"
                      // Placed by its centre on Figma's 115 × 80 card, so it stays right when cards narrow or grow.
                      style={
                        {
                          "--x": d.thumb.x + d.thumb.w / 2 - 57.5,
                          "--y": d.thumb.y + d.thumb.h / 2 - 40,
                          "--w": d.thumb.w,
                          "--h": d.thumb.h,
                        } as CSSProperties
                      }
                    />
                  </button>
                );
              })}
            </div>
          </div>

          <PillButton type="submit" busy={checking} className="lg:mx-auto lg:w-[280px] lg:shrink-0">
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
    // Web: 32px above and below, 16px between title, list and button.
    <Modal onClose={onDone} figmaTop={209} className="max-w-[334px] !pt-6 lg:!py-8">
      {(titleId) => (
        <div className="flex flex-col gap-8 lg:gap-4">
          <div className="flex flex-col gap-4">
            <h2 id={titleId} className="pr-8 font-[family-name:var(--dc-headline)] text-xl leading-6 font-bold">
              Quick Heads-Up!
            </h2>
            <ol className="list-decimal pl-5 text-xs leading-[18px] text-[#8A8A8A]">
              <li>Your main-character moment starts at 10AM and ends at 10PM</li>
              <li>Not every entry makes the cut. Only a few DC Paglus win the daily draw.</li>
              <li>If you win, you’ll receive an email soon.</li>
            </ol>
          </div>
          <PillButton type="button" onClick={onDone} className="lg:mx-auto lg:w-[280px]">
            Let’s Do This
          </PillButton>
        </div>
      )}
    </Modal>
  );
}

function Rejected({ onEdit }: { onEdit: () => void }) {
  return (
    // Web: the icon 54px from the top, 16px between every piece.
    <Modal onClose={onEdit} figmaTop={209} className="lg:pt-[54px] lg:pb-6">
      {(titleId) => (
        <div className="flex flex-col gap-8 lg:gap-4">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex h-[84px] w-[84px] items-center justify-center rounded-full bg-[#F40009]/12">
              <div className="flex h-[58px] w-[58px] items-center justify-center rounded-full bg-[#F40009] shadow-[0_0_12px_rgba(245,0,9,0.35)]">
                <svg width="6" height="31" viewBox="0 0 6 31" aria-hidden="true">
                  <rect x="0.5" width="5" height="20" rx="2.5" fill="#fff" />
                  <circle cx="3" cy="28" r="3" fill="#fff" />
                </svg>
              </div>
            </div>
            <div className="flex flex-col gap-2 lg:gap-4">
              <h2 id={titleId} className="font-[family-name:var(--dc-headline)] text-xl leading-6 font-bold">
                Let’s keep it friendly
              </h2>
              <p className="text-xs leading-[18px] text-[#8A8A8A]">
                This content didn’t make the cut, let’s change it and try again
              </p>
            </div>
          </div>
          <PillButton type="button" onClick={onEdit} className="lg:mx-auto lg:w-[280px]">
            Edit Text
          </PillButton>
        </div>
      )}
    </Modal>
  );
}
