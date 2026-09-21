"use client";

import { isHeld, type Order } from "@/lib/types";

import { dateTime, money } from "@/lib/format";

import { EmptyState, ModerationChip, StatusChip } from "./ui";

export function OrderTable({
  orders,
  onSelect,
  showStore = false,
  emptyHint,
}: {
  orders: Order[];
  onSelect: (order: Order) => void;
  showStore?: boolean;
  emptyHint?: string;
}) {
  if (orders.length === 0) {
    return (
      <div className="card">
        <EmptyState title="No orders here" hint={emptyHint} icon="🖨" />
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse">
          <thead className="border-b border-cream-200 bg-cream/60">
            <tr>
              <th className="th">Order</th>
              {showStore && <th className="th">Store</th>}
              <th className="th">Text</th>
              <th className="th">Template</th>
              <th className="th text-right">Amount</th>
              <th className="th">Status</th>
              <th className="th">Created</th>
              <th className="th" />
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr
                key={order.id}
                onClick={() => onSelect(order)}
                className="cursor-pointer border-b border-cream-200 transition last:border-0 hover:bg-cream/70"
              >
                <td className="td font-black">
                  {order.order_ref}
                  {order.reprint_count > 0 && (
                    <span className="ml-2 text-[11px] font-bold text-brand-500">
                      ×{order.reprint_count + 1}
                    </span>
                  )}
                </td>
                {showStore && (
                  <td className="td">
                    <span className="font-bold">{order.store?.code}</span>
                    <span className="block text-xs text-ink-400">{order.store?.name}</span>
                  </td>
                )}
                <td className="td max-w-[260px]">
                  <span className="block truncate" title={order.print_text}>
                    {order.print_text || <span className="text-ink-400">(blank)</span>}
                  </span>
                </td>
                <td className="td">
                  <span className="chip bg-cream-200 text-ink-600">{order.print_format?.code}</span>
                </td>
                <td className="td text-right font-bold whitespace-nowrap">{money(order.amount)}</td>
                <td className="td">
                  <div className="flex flex-wrap gap-1">
                    <StatusChip status={order.status} />
                    <ModerationChip status={order.moderation_status} reason={order.moderation_reason} />
                  </div>
                  {isHeld(order.moderation_status) && order.moderation_reason && (
                    <span
                      className="mt-1 block max-w-[220px] truncate text-[11px] text-amber-700"
                      title={order.moderation_reason}
                    >
                      {order.moderation_reason}
                    </span>
                  )}
                  {order.status === "FAILED" && order.last_error && (
                    <span className="mt-1 block max-w-[220px] truncate text-[11px] text-rose-600" title={order.last_error}>
                      {order.last_error}
                    </span>
                  )}
                </td>
                <td className="td whitespace-nowrap text-ink-400">{dateTime(order.created_at)}</td>
                <td className="td text-right">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(order);
                    }}
                    className={
                      isHeld(order.moderation_status) || order.status === "PRINTED"
                        ? "btn-secondary btn-sm"
                        : "btn-primary btn-sm"
                    }
                  >
                    {isHeld(order.moderation_status) ? "On hold" : order.status === "PRINTED" ? "Reprint" : "Print"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
