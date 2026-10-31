"use client";

import { useEffect, useId, type ButtonHTMLAttributes, type ReactNode } from "react";

/** The black 48px pill every Figma screen uses for its primary action. */
export function PillButton({
  busy,
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      aria-busy={busy || undefined}
      className={`flex h-12 w-full items-center justify-center rounded-full bg-black text-sm leading-[16.8px] font-semibold text-white transition active:scale-[0.99] disabled:opacity-50 ${className}`}
    >
      {busy ? (
        <span
          role="status"
          aria-label="Loading"
          className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white"
        />
      ) : (
        children
      )}
    </button>
  );
}

function CloseIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 7l10 10M17 7L7 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Height of the Figma screen below the mocked browser bar (874 − 99). */
const FIGMA_VIEWPORT_H = 775;

/**
 * White card over a 60% black scrim, as in the Figma popups. Escape and the
 * close button both call `onClose`; omit it for a popup that must be answered.
 * `children` receives the id to put on the title, which names the dialog.
 *
 * `figmaTop` is the card's top on the 775px Figma screen. By default it is kept
 * as an offset from the vertical centre, so taller or shorter phones shift it
 * evenly. `anchor="bottom"` keeps it as a distance from the foot instead, for
 * popups over a screen whose content is pinned to the bottom.
 */
export function Modal({
  onClose,
  children,
  figmaTop,
  anchor = "centre",
  className = "",
}: {
  onClose?: () => void;
  children: (titleId: string) => ReactNode;
  figmaTop: number;
  anchor?: "centre" | "bottom";
  className?: string;
}) {
  const titleId = useId();
  const top =
    anchor === "bottom"
      ? `max(16px, calc(100% - ${FIGMA_VIEWPORT_H - figmaTop}px))`
      : `calc(50% - ${FIGMA_VIEWPORT_H / 2 - figmaTop}px)`;

  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/60">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ top }}
        className={`animate-rise absolute left-1/2 w-[calc(100%-68px)] max-w-[318px] -translate-x-1/2 rounded-[28px] bg-white px-6 pt-8 pb-6 shadow-[0_16px_40px_rgba(0,0,0,0.25)] ${className}`}
      >
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute top-4 right-4 flex h-6 w-6 items-center justify-center text-black"
          >
            <CloseIcon />
          </button>
        )}
        {children(titleId)}
      </div>
    </div>
  );
}

/** 40px outlined circle used for back / download / share on the preview screen. */
export function CircleButton({
  label,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className="flex h-10 w-10 items-center justify-center rounded-full border border-[#E5E5E5] bg-white text-black transition active:scale-95 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function FieldError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-[11px] leading-snug font-medium text-[#F40009]">
      {children}
    </p>
  );
}
