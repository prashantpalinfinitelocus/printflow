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
      className={`flex h-12 w-full items-center justify-center rounded-full bg-black text-sm font-semibold text-white transition active:scale-[0.99] disabled:opacity-50 ${className}`}
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

/**
 * White card over a 60% black scrim, as in the Figma popups. Escape and the
 * close button both call `onClose`; omit it for a popup that must be answered.
 * `children` receives the id to put on the title, which names the dialog.
 */
export function Modal({
  onClose,
  children,
  className = "",
}: {
  onClose?: () => void;
  children: (titleId: string) => ReactNode;
  className?: string;
}) {
  const titleId = useId();

  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-[34px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`animate-rise relative w-full max-w-[318px] rounded-[28px] bg-white px-6 pt-8 pb-6 shadow-[0_0_40px_rgba(0,0,0,0.25)] ${className}`}
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
