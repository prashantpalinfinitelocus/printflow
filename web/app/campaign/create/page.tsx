"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { CanPreview } from "@/components/campaign/CanPreview";
import { FieldError, Modal, PillButton } from "@/components/campaign/ui";
import { campaignApi } from "@/lib/campaign/api";
import { DESIGNS } from "@/lib/campaign/designs";
import { useCampaign } from "@/lib/campaign/store";
import { MAX_TEXT_LENGTH, textLength, validateText } from "@/lib/campaign/text";

const CHECKER_DOWN = "Our message checker needs a moment. Your design is still here — please try again.";

/** Customising tool — Figma 243:872, with popups 243:936 (heads-up) and 243:1013 (rejected). */
export default function CreatePage() {
  const router = useRouter();
  const { ready, session, designId, text, approvedText, headsUpSeen, update } = useCampaign();
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [rejected, setRejected] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ready && !session) router.replace("/campaign?login=1");
  }, [ready, session, router]);

  if (!ready || !session) return null;
  const token = session.token;

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
      router.push("/campaign/preview");
      return;
    }
    setChecking(true);
    setError(null);
    try {
      if ((await campaignApi.moderateText(token, clean)) === "APPROVED") {
        update({ text: clean, approvedText: clean });
        router.push("/campaign/preview");
        return;
      }
      setRejected(true);
    } catch {
      // Fail safe: an unavailable checker never lets text through (PRD 6.3).
      setError(CHECKER_DOWN);
    }
    setChecking(false);
  }

  return (
    <main className="flex h-dvh flex-col bg-white">
      <p className="pt-4 text-center text-[10px] leading-3 font-semibold tracking-[0.16em] text-[#F40009] uppercase">
        Diet Coke &nbsp;·&nbsp; Custom Edition
      </p>

      <div className="flex min-h-0 flex-1 items-center justify-center py-4">
        <CanPreview designId={designId} text={text.trim()} priority className="h-full max-h-[367px]" />
      </div>

      <form
        onSubmit={check}
        noValidate
        className="flex flex-col gap-3 rounded-t-[28px] border-t border-[#EDEDED] bg-white px-5 pt-5 pb-[max(8px,env(safe-area-inset-bottom))] shadow-[0_-4px_12px_rgba(0,0,0,0.06)]"
      >
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-2 rounded-[14px] border-[0.5px] border-[#E8E8E8] px-4 py-3 focus-within:border-[#8A8A8A]">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[10px] leading-3 font-semibold text-[#F40009]">Enter Text</span>
              <input
                ref={inputRef}
                value={text}
                onChange={(e) => {
                  // Cap by characters, not UTF-16 units, so a Devanagari name isn't cut mid-letter.
                  update({ text: Array.from(e.target.value).slice(0, MAX_TEXT_LENGTH).join("") });
                  setError(null);
                }}
                placeholder="Your name or a short message"
                autoComplete="off"
                enterKeyHint="done"
                aria-invalid={Boolean(error)}
                className="w-full bg-transparent text-xl leading-6 text-[#111111] outline-none placeholder:text-base placeholder:text-[#B5B5B5]"
              />
            </span>
            <span className="text-xs font-semibold text-[#8A8A8A] tabular-nums" aria-live="polite">
              {textLength(text)}/{MAX_TEXT_LENGTH}
            </span>
          </label>
          <FieldError>{error}</FieldError>
        </div>

        <div className="flex min-h-0 flex-col gap-2">
          <p id="dc-vibe" className="text-xs leading-[1.2] font-bold text-[#111111]">
            Pick your vibe
          </p>
          <div
            role="radiogroup"
            aria-labelledby="dc-vibe"
            className="grid max-h-[150px] grid-cols-3 gap-2 overflow-y-auto p-0.5 [scrollbar-width:none]"
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
                  className={`relative h-20 overflow-hidden rounded-2xl border bg-white transition ${
                    selected ? "border-black shadow-[0_0_12px_rgba(0,0,0,0.08)]" : "border-[#E8E8E8]"
                  }`}
                >
                  <Image src={d.sticker} alt="" fill sizes="120px" className="object-contain p-0.5" />
                </button>
              );
            })}
          </div>
        </div>

        <PillButton type="submit" busy={checking}>
          Check my vibe
        </PillButton>
      </form>

      {!headsUpSeen && <HeadsUp onDone={() => update({ headsUpSeen: true })} />}
      {rejected && (
        <Rejected
          onEdit={() => {
            setRejected(false);
            inputRef.current?.focus();
          }}
        />
      )}
    </main>
  );
}

function HeadsUp({ onDone }: { onDone: () => void }) {
  return (
    <Modal onClose={onDone} className="max-w-[334px] !pt-6">
      {(titleId) => (
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-4">
            <h2 id={titleId} className="pr-8 text-xl leading-6 font-bold">
              Quick Heads-Up!
            </h2>
            <ol className="list-decimal pl-5 text-xs leading-[18px] text-[#8A8A8A]">
              <li>Your main-character moment starts at 10AM and ends at 10PM IST</li>
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
    <Modal onClose={onEdit}>
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
              <h2 id={titleId} className="text-xl leading-6 font-bold">
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
