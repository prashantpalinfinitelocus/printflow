"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import type { User } from "@/lib/types";

const ADMIN_NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/upload", label: "CSV Intake" },
  { href: "/admin/orders", label: "All Orders" },
  { href: "/admin/stores", label: "Stores" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/formats", label: "Print Formats" },
];

const OPERATOR_NAV = [{ href: "/queue", label: "Print Queue" }];

export function Shell({ user, children }: { user: User; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const nav = user.role === "ADMIN" ? ADMIN_NAV : OPERATOR_NAV;

  const isActive = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);

  async function signOut() {
    setSigningOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b border-cream-200 bg-cream/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-5">
          <Link href="/" className="flex shrink-0 items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-500 text-base font-black text-white">
              P
            </span>
            <span className="hidden text-base font-black tracking-tight sm:block">PrintFlow</span>
          </Link>

          <nav className="scroll-slim flex flex-1 items-center gap-1 overflow-x-auto">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`whitespace-nowrap rounded-[var(--radius-pill)] px-3.5 py-2 text-sm font-bold transition ${
                  isActive(item.href)
                    ? "bg-brand-500 text-white"
                    : "text-ink-600 hover:bg-cream-200 hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm leading-tight font-bold">{user.full_name || user.email}</p>
              <p className="text-[11px] leading-tight font-bold tracking-wide text-ink-400 uppercase">
                {user.role === "ADMIN" ? "Administrator" : (user.store?.code ?? "No store")}
              </p>
            </div>
            <button onClick={signOut} disabled={signingOut} className="btn-secondary btn-sm">
              {signingOut ? "…" : "Sign out"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-8">{children}</main>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="mt-1 text-3xl font-black tracking-tight">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-ink-400">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
