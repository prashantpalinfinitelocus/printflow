"use client";

import { useEffect, type ReactNode } from "react";

import type { ModerationStatus, OrderStatus } from "@/lib/types";

/* ---------------- status chip ---------------- */

const STATUS_STYLE: Record<OrderStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  PRINTING: "bg-sky-100 text-sky-800",
  PRINTED: "bg-emerald-100 text-emerald-800",
  FAILED: "bg-rose-100 text-rose-800",
};

const STATUS_DOT: Record<OrderStatus, string> = {
  PENDING: "bg-amber-500",
  PRINTING: "bg-sky-500",
  PRINTED: "bg-emerald-500",
  FAILED: "bg-rose-500",
};

export function StatusChip({ status }: { status: OrderStatus }) {
  return (
    <span className={`chip ${STATUS_STYLE[status]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
      {status}
    </span>
  );
}

/* ---------------- moderation chip ---------------- */

const MODERATION_STYLE: Record<ModerationStatus, { chip: string; dot: string; label: string }> = {
  UNCHECKED: { chip: "bg-cream-200 text-ink-600", dot: "bg-ink-400", label: "Unchecked" },
  CLEAR: { chip: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-400", label: "Text OK" },
  FLAGGED: { chip: "bg-rose-100 text-rose-800", dot: "bg-rose-500", label: "Flagged" },
  NEEDS_REVIEW: { chip: "bg-amber-100 text-amber-800", dot: "bg-amber-500", label: "Needs review" },
  APPROVED: { chip: "bg-sky-100 text-sky-800", dot: "bg-sky-500", label: "Approved" },
  REJECTED: { chip: "bg-ink text-cream", dot: "bg-rose-400", label: "Rejected" },
};

/** Brand-safety state of the order text. CLEAR is the quiet default and is
 *  hidden unless `always` is set, so the queue only draws the eye to holds. */
export function ModerationChip({
  status,
  reason,
  always = false,
}: {
  status: ModerationStatus;
  reason?: string | null;
  always?: boolean;
}) {
  if (status === "CLEAR" && !always) return null;
  const style = MODERATION_STYLE[status];
  return (
    <span className={`chip ${style.chip}`} title={reason ?? undefined}>
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}

/* ---------------- modal ---------------- */

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  width = "max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/45 p-4 py-10 backdrop-blur-[2px]">
      <div
        className="absolute inset-0"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`card animate-rise relative w-full ${width} shadow-[var(--shadow-lift)]`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-cream-200 px-6 py-5">
          <div>
            <h2 className="text-lg font-black tracking-tight">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-ink-400">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="btn-ghost btn-sm -mr-2 -mt-1" aria-label="Close">
            ✕
          </button>
        </header>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

/* ---------------- feedback ---------------- */

export function Banner({
  kind,
  children,
}: {
  kind: "error" | "success" | "info" | "warning";
  children: ReactNode;
}) {
  const styles = {
    error: "border-rose-200 bg-rose-50 text-rose-900",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900",
    info: "border-sky-200 bg-sky-50 text-sky-900",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
  }[kind];
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${styles}`} role={kind === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export function EmptyState({ title, hint, icon = "◍" }: { title: string; hint?: string; icon?: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-cream-200 text-2xl text-ink-400">
        {icon}
      </div>
      <p className="font-bold text-ink">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-sm text-ink-400">{hint}</p>}
    </div>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      aria-hidden
    />
  );
}

export function StatCard({
  label,
  value,
  accent = false,
  hint,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
  hint?: string;
}) {
  return (
    <div className={`card px-5 py-4 ${accent ? "border-brand-200 bg-brand-50" : ""}`}>
      <p className="text-[11px] font-black uppercase tracking-[0.1em] text-ink-400">{label}</p>
      <p className={`mt-1 text-3xl font-black tracking-tight ${accent ? "text-brand-600" : "text-ink"}`}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-ink-400">{hint}</p>}
    </div>
  );
}

