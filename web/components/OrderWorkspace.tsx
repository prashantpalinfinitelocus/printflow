"use client";

import { useCallback, useEffect, useState } from "react";

import { get } from "@/lib/client";
import type { Order, OrderPage, OrderStats, OrderStatus, Store } from "@/lib/types";

import { OrderTable } from "./OrderTable";
import { PrintDialog } from "./PrintDialog";
import { money } from "@/lib/format";

import { Banner, Spinner, StatCard } from "./ui";

const FILTERS: { label: string; value: OrderStatus | "ALL" }[] = [
  { label: "Pending", value: "PENDING" },
  { label: "Printed", value: "PRINTED" },
  { label: "Failed", value: "FAILED" },
  { label: "All", value: "ALL" },
];

const PAGE_SIZE = 25;

export function OrderWorkspace({
  showStore = false,
  stores = [],
}: {
  showStore?: boolean;
  stores?: Store[];
}) {
  const [status, setStatus] = useState<OrderStatus | "ALL">("PENDING");
  const [storeId, setStoreId] = useState<string>("");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);

  const [data, setData] = useState<OrderPage | null>(null);
  const [stats, setStats] = useState<OrderStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Order | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Any filter change restarts pagination — otherwise page 3 of a 1-page result is empty.
  useEffect(() => setPage(1), [status, storeId, debounced]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
    if (status !== "ALL") params.set("status", status);
    if (storeId) params.set("store_id", storeId);
    if (debounced) params.set("q", debounced);

    const statParams = storeId ? `?store_id=${storeId}` : "";
    try {
      const [orders, orderStats] = await Promise.all([
        get<OrderPage>(`/orders?${params}`),
        get<OrderStats>(`/orders/stats${statParams}`),
      ]);
      setData(orders);
      setStats(orderStats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load orders");
    } finally {
      setLoading(false);
    }
  }, [page, status, storeId, debounced]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Keep the row and the open dialog in sync after a print without a full refetch. */
  const applyOrderUpdate = useCallback((updated: Order) => {
    setData((current) =>
      current
        ? { ...current, items: current.items.map((o) => (o.id === updated.id ? updated : o)) }
        : current,
    );
    setSelected((current) => (current && current.id === updated.id ? updated : current));
  }, []);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <div className="space-y-5">
      {stats && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Pending" value={stats.pending} accent hint={money(stats.amount_pending)} />
          <StatCard label="Printed" value={stats.printed} />
          <StatCard label="Failed" value={stats.failed} />
          <StatCard label="Total orders" value={stats.total} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-[var(--radius-pill)] bg-cream-200 p-1">
          {FILTERS.map((filter) => (
            <button
              key={filter.value}
              onClick={() => setStatus(filter.value)}
              className={`rounded-[var(--radius-pill)] px-4 py-1.5 text-xs font-black transition ${
                status === filter.value ? "bg-white text-ink shadow-sm" : "text-ink-400 hover:text-ink"
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>

        {showStore && stores.length > 0 && (
          <select
            className="input w-auto min-w-44"
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
            aria-label="Filter by store"
          >
            <option value="">All stores</option>
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.code} — {store.name}
              </option>
            ))}
          </select>
        )}

        <input
          className="input w-auto min-w-56 flex-1"
          placeholder="Search order id or text…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search orders"
        />

        <button onClick={() => void load()} className="btn-secondary btn-sm" disabled={loading}>
          {loading ? <Spinner /> : "↻"} Refresh
        </button>
      </div>

      {error && <Banner kind="error">{error}</Banner>}

      {loading && !data ? (
        <div className="card flex items-center justify-center gap-3 py-20 text-ink-400">
          <Spinner /> Loading orders…
        </div>
      ) : (
        <OrderTable
          orders={data?.items ?? []}
          onSelect={setSelected}
          showStore={showStore}
          emptyHint={
            status === "PENDING"
              ? "Nothing waiting to print. New orders appear here as soon as an admin uploads a CSV."
              : "Try a different filter or search term."
          }
        />
      )}

      {data && data.total > data.page_size && (
        <div className="flex items-center justify-between text-sm">
          <p className="text-ink-400">
            Page {data.page} of {totalPages} · {data.total} orders
          </p>
          <div className="flex gap-2">
            <button
              className="btn-secondary btn-sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <button
              className="btn-secondary btn-sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}

      <PrintDialog
        order={selected}
        onClose={() => {
          setSelected(null);
          void load();
        }}
        onPrinted={applyOrderUpdate}
      />
    </div>
  );
}
