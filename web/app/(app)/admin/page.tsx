import Link from "next/link";

import { PageHeader } from "@/components/Shell";
import { StatCard } from "@/components/ui";
import { dateTime, money } from "@/lib/format";
import { apiJson } from "@/lib/session";
import type { CsvBatch, OrderStats, Store } from "@/lib/types";

export default async function AdminOverviewPage() {
  const [stats, stores, batches] = await Promise.all([
    apiJson<OrderStats>("/orders/stats"),
    apiJson<Store[]>("/stores"),
    apiJson<CsvBatch[]>("/csv/batches?limit=5"),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Overview"
        description="Where every store stands right now, and what the last CSV drops did."
        actions={
          <Link href="/admin/upload" className="btn-primary btn-sm">
            Upload CSV
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Pending"
          value={stats?.pending ?? 0}
          accent
          hint={stats ? money(stats.amount_pending) : undefined}
        />
        <StatCard label="Printed" value={stats?.printed ?? 0} />
        <StatCard label="Failed" value={stats?.failed ?? 0} />
        <StatCard label="Total orders" value={stats?.total ?? 0} />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <section className="card overflow-hidden">
          <header className="flex items-center justify-between border-b border-cream-200 px-5 py-4">
            <h2 className="font-black tracking-tight">Stores</h2>
            <Link href="/admin/stores" className="text-xs font-bold text-brand-500 hover:underline">
              Manage →
            </Link>
          </header>
          <ul>
            {(stores ?? []).map((store) => (
              <li
                key={store.id}
                className="flex items-center justify-between border-b border-cream-200 px-5 py-3.5 last:border-0"
              >
                <div>
                  <p className="font-bold">
                    {store.code}
                    {!store.is_active && (
                      <span className="ml-2 chip bg-cream-200 text-ink-400">inactive</span>
                    )}
                  </p>
                  <p className="text-xs text-ink-400">
                    {store.name} · {store.user_count ?? 0} user
                    {(store.user_count ?? 0) === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-black text-brand-500">{store.pending_orders ?? 0}</p>
                  <p className="text-[11px] font-bold tracking-wide text-ink-400 uppercase">
                    pending
                  </p>
                </div>
              </li>
            ))}
            {(stores ?? []).length === 0 && (
              <li className="px-5 py-8 text-center text-sm text-ink-400">
                No stores yet — create one to start routing orders.
              </li>
            )}
          </ul>
        </section>

        <section className="card overflow-hidden">
          <header className="flex items-center justify-between border-b border-cream-200 px-5 py-4">
            <h2 className="font-black tracking-tight">Recent CSV imports</h2>
            <Link href="/admin/upload" className="text-xs font-bold text-brand-500 hover:underline">
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
                  <p className="text-xs text-ink-400">
                    {dateTime(batch.created_at)} · via {batch.source}
                  </p>
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
                No CSVs imported yet.
              </li>
            )}
          </ul>
        </section>
      </div>
    </>
  );
}
