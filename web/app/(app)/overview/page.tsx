import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/Shell";
import { StatCard } from "@/components/ui";
import { dateTime, money } from "@/lib/format";
import { apiJson, getCurrentUser } from "@/lib/session";
import type { CsvBatch, OrderStats } from "@/lib/types";

/** The operator's version of the admin overview, scoped to their store by the API. */
export default async function OperatorOverviewPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "ADMIN") redirect("/admin");

  const [stats, batches] = await Promise.all([
    apiJson<OrderStats>("/orders/stats"),
    apiJson<CsvBatch[]>("/csv/batches?limit=5"),
  ]);

  return (
    <>
      <PageHeader
        eyebrow={user.store ? `${user.store.code} · ${user.store.city ?? ""}` : "Unassigned"}
        title="Overview"
        description="Where your store stands right now, and what your last CSV uploads did."
        actions={
          <>
            <Link href="/upload" className="btn-secondary btn-sm">
              Upload CSV
            </Link>
            <Link href="/queue" className="btn-primary btn-sm">
              Open queue
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard
          label="Pending"
          value={stats?.pending ?? 0}
          accent
          hint={stats ? money(stats.amount_pending) : undefined}
        />
        <StatCard label="On hold" value={stats?.on_hold ?? 0} hint="Text needs a review" />
        <StatCard label="Printed" value={stats?.printed ?? 0} />
        <StatCard label="Failed" value={stats?.failed ?? 0} />
        <StatCard label="Total orders" value={stats?.total ?? 0} />
      </div>

      <section className="card mt-6 overflow-hidden">
        <header className="flex items-center justify-between border-b border-cream-200 px-5 py-4">
          <h2 className="font-black tracking-tight">My recent imports</h2>
          <Link href="/upload" className="text-xs font-bold text-brand-500 hover:underline">
            Import →
          </Link>
        </header>
        <ul>
          {(batches ?? []).map((batch) => (
            <li
              key={batch.id}
              className="flex items-center justify-between gap-3 border-b border-cream-200 px-5 py-3.5 last:border-0"
            >
              <div className="min-w-0">
                <p className="truncate font-bold">{batch.filename}</p>
                <p className="text-xs text-ink-400">{dateTime(batch.created_at)}</p>
              </div>
              <div className="shrink-0 text-right text-sm">
                <span className="font-black text-emerald-600">{batch.imported}</span>
                <span className="text-ink-400"> imported</span>
                {batch.skipped > 0 && (
                  <>
                    <br />
                    <span className="font-black text-rose-600">{batch.skipped}</span>
                    <span className="text-ink-400"> skipped</span>
                  </>
                )}
              </div>
            </li>
          ))}
          {(batches ?? []).length === 0 && (
            <li className="px-5 py-8 text-center text-sm text-ink-400">
              You have not uploaded any CSVs yet.
            </li>
          )}
        </ul>
      </section>
    </>
  );
}
