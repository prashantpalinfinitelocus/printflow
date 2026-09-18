"use client";

import { useCallback, useEffect, useState } from "react";

import { artifactUrl, get, post } from "@/lib/client";
import type { Delivery, JobKind, Order, PrintJob, Printer, PrintResponse } from "@/lib/types";

import { dateTime, money } from "@/lib/format";

import { Banner, Modal, Spinner, StatusChip } from "./ui";

/** Click a hidden link — the proxy sends the session cookie and Content-Disposition
 *  makes the browser save rather than navigate. */
function triggerDownload(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function PrintDialog({
  order,
  onClose,
  onPrinted,
}: {
  order: Order | null;
  onClose: () => void;
  onPrinted: (order: Order) => void;
}) {
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [printerName, setPrinterName] = useState<string>("");
  const [kind, setKind] = useState<JobKind>("TIFF");
  const [copies, setCopies] = useState(1);

  const [busy, setBusy] = useState<"proof" | "print" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [lastJob, setLastJob] = useState<PrintJob | null>(null);
  const [history, setHistory] = useState<PrintJob[]>([]);

  const isReprint = order?.status === "PRINTED";

  const loadHistory = useCallback(async (orderId: number) => {
    try {
      setHistory(await get<PrintJob[]>(`/orders/${orderId}/jobs`));
    } catch {
      /* history is informational — a failure here must not block printing */
    }
  }, []);

  // Keyed on the id, not the object: a successful print replaces `order` with a
  // fresh instance, and re-running this on identity would wipe the result banner
  // and the operator's format/copies choice the moment it succeeded.
  const orderId = order?.id;

  useEffect(() => {
    if (orderId === undefined) return;
    setError(null);
    setNotice(null);
    setWarning(null);
    setLastJob(null);
    setCopies(1);
    setKind("TIFF");
    void loadHistory(orderId);

    get<Printer[]>("/printers")
      .then((list) => {
        setPrinters(list);
        setPrinterName(list.find((p) => p.is_default)?.name ?? list[0]?.name ?? "");
      })
      .catch(() => setPrinters([]));
  }, [orderId, loadHistory]);

  if (!order) return null;

  // When the format names a paper size the artifact arrives already laid out on
  // that sheet, so "print at 100%" is the whole instruction — there is no
  // fit-to-frame default left to warn the operator about.
  const pageSize = order.print_format?.page_size ?? null;
  // Light ink needs building up: this design has to go onto the same object N
  // times. The operator must see it before printing, not in a result banner.
  const passes = order.print_format?.print_passes ?? 1;
  // White is laid by the press from spot channels in the file, not by the app.
  const whitePasses = order.print_format?.white_passes ?? 0;
  // What the type actually came out at. The format's font_size is only a
  // ceiling the renderer shrinks from, so this is the number that matters.
  const lastRenderSize =
    lastJob?.font_size_used ??
    history.find((j) => j.font_size_used !== null)?.font_size_used ??
    null;

  async function run(delivery: Delivery, jobKind: JobKind) {
    if (!order) return;
    setBusy(delivery === "PROOF" ? "proof" : "print");
    setError(null);
    setNotice(null);
    setWarning(null);
    try {
      const result = await post<PrintResponse>(`/orders/${order.id}/print`, {
        kind: jobKind,
        printer_name: delivery === "PRINTER" ? printerName || null : null,
        delivery,
        copies,
      });
      setLastJob(result.job);
      setWarning(result.warning);
      onPrinted(result.order);
      void loadHistory(order.id);

      if (delivery === "DOWNLOAD") {
        // Hand the file straight to the browser; the operator prints it from
        // their own machine, where the printer actually is.
        triggerDownload(artifactUrl(order.id, jobKind.toLowerCase() as "tiff" | "pdf", result.job.id));
      }

      setNotice(
        delivery === "PRINTER"
          ? `Sent ${jobKind} to ${result.job.printer_name ?? "the default printer"}` +
            (result.job.passes > 1 ? ` as ${result.job.passes} passes` : "") +
            (result.job.cups_job_id ? ` — job ${result.job.cups_job_id}` : "") +
            "."
          : delivery === "DOWNLOAD"
            ? (passes > 1
                ? `${jobKind} downloaded and the order marked printed. Run it ${passes} times on ` +
                  `the same object without taking it out of the jig. `
                : `${jobKind} downloaded and the order marked printed. `) +
              (pageSize
                ? `It is already laid out on ${pageSize} — load that paper and print at 100%.`
                : `Print at 100% — untick "Fit picture to frame" so the artwork lines up with ` +
                  `the die-cut.`)
            : "Proof generated. Nothing was sent to the printer and the status is unchanged.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  const previewJobId = lastJob?.id ?? history.find((j) => j.status !== "FAILED")?.id;
  const noPrinters = printers.length === 0;

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-3xl"
      title={order.order_ref}
      subtitle={`${order.store?.name ?? "—"} · ${order.print_format?.name ?? "—"}`}
    >
      <div className="grid gap-6 md:grid-cols-[1.05fr_1fr]">
        {/* ---- left: what will be printed ---- */}
        <div className="space-y-4">
          <div className="rounded-xl border border-cream-200 bg-cream p-4">
            <p className="label mb-2">Text to print</p>
            <p className="text-lg leading-snug font-bold break-words">
              {order.print_text || <span className="text-ink-400">(blank)</span>}
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="label">Status</dt>
              <dd>
                <StatusChip status={order.status} />
              </dd>
            </div>
            <div>
              <dt className="label">Amount</dt>
              <dd className="font-bold">{money(order.amount)}</dd>
            </div>
            <div>
              <dt className="label">Template</dt>
              <dd className="font-bold">{order.print_format?.code}</dd>
            </div>
            <div>
              <dt className="label">Canvas</dt>
              <dd className="font-bold">
                {order.print_format
                  ? `${order.print_format.width_px}×${order.print_format.height_px} @ ${order.print_format.dpi}dpi`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="label">Print on</dt>
              <dd className="font-bold">{pageSize ?? "Label only"}</dd>
            </div>
            <div>
              <dt className="label">Type size</dt>
              <dd className="font-bold">
                {lastRenderSize !== null ? (
                  <>
                    {lastRenderSize}px
                    {order.print_format && lastRenderSize < order.print_format.font_size && (
                      <span className="block text-[11px] font-normal text-ink-400">
                        box capped it from {order.print_format.font_size}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-ink-400">
                    max {order.print_format?.font_size ?? "—"}
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="label">White</dt>
              <dd className="font-bold">
                {whitePasses > 0 ? (
                  <span className="text-brand-600">{whitePasses}× under artwork</span>
                ) : (
                  "None"
                )}
              </dd>
            </div>
            <div>
              <dt className="label">Passes</dt>
              <dd className="font-bold">
                {passes > 1 ? (
                  <span className="text-brand-600">{passes}× same object</span>
                ) : (
                  "Single"
                )}
              </dd>
            </div>
            {order.reprint_count > 0 && (
              <div>
                <dt className="label">Reprints</dt>
                <dd className="font-bold">{order.reprint_count}</dd>
              </div>
            )}
            {order.printed_at && (
              <div>
                <dt className="label">Last printed</dt>
                <dd className="font-bold">{dateTime(order.printed_at)}</dd>
              </div>
            )}
          </dl>

          {previewJobId && (
            <div>
              <p className="label">Rendered preview</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={artifactUrl(order.id, "preview", previewJobId)}
                alt={`Rendered artwork for ${order.order_ref}`}
                className="w-full rounded-xl border border-cream-200 bg-white"
              />
              <div className="mt-2 flex gap-2">
                <a
                  className="btn-secondary btn-sm"
                  href={artifactUrl(order.id, "pdf", previewJobId)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open PDF proof
                </a>
                <a
                  className="btn-secondary btn-sm"
                  href={artifactUrl(order.id, "tiff", previewJobId)}
                  download
                >
                  Download TIFF
                </a>
              </div>
            </div>
          )}
        </div>

        {/* ---- right: how to print it ---- */}
        <div className="space-y-4">
          {error && <Banner kind="error">{error}</Banner>}
          {notice && <Banner kind="success">{notice}</Banner>}
          {warning && <Banner kind="warning">{warning}</Banner>}
          {passes > 1 && (
            <Banner kind="warning">
              This design needs <strong>{passes} passes</strong> on the{" "}
              <strong>same</strong> item. One pass goes down translucent and the can&apos;s own
              artwork shows through.{" "}
              {noPrinters
                ? `Print the downloaded file ${passes} times without taking the item out of the jig.`
                : `Printing sends it ${passes} times — leave the item in the jig until all ${passes} are done.`}{" "}
              It still counts as one print, not {passes - 1} reprint
              {passes - 1 === 1 ? "" : "s"}.
            </Banner>
          )}
          {noPrinters && (
            <Banner kind="info">
              This server has no printer attached — download the file and print it from this
              computer.{" "}
              {pageSize ? (
                <>
                  The file is already laid out on <strong>{pageSize}</strong>, so load that paper
                  and print at <strong>100%</strong>.
                </>
              ) : (
                <>
                  In the Windows print dialog, choose <strong>Actual size</strong> and untick{" "}
                  <strong>Fit picture to frame</strong>, or the artwork will not line up with the
                  die-cut.
                </>
              )}
            </Banner>
          )}

          <div className={noPrinters ? "hidden" : undefined}>
            <label className="label" htmlFor="printer">
              Printer
            </label>
            <select
              id="printer"
              className="input"
              value={printerName}
              onChange={(e) => setPrinterName(e.target.value)}
              disabled={noPrinters}
            >
              {noPrinters && <option value="">No printers found</option>}
              {printers.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name} — {p.status}
                  {p.is_default ? " (default)" : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="label">Send as</span>
              <div className="flex rounded-[var(--radius-pill)] bg-cream-200 p-1">
                {(["TIFF", "PDF"] as JobKind[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    className={`flex-1 rounded-[var(--radius-pill)] px-3 py-1.5 text-xs font-black transition ${
                      kind === k ? "bg-white text-ink shadow-sm" : "text-ink-400 hover:text-ink"
                    }`}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label" htmlFor="copies">
                Copies
              </label>
              <input
                id="copies"
                type="number"
                min={1}
                max={20}
                className="input"
                value={copies}
                onChange={(e) => setCopies(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
              />
            </div>
          </div>

          <p className="text-xs leading-relaxed text-ink-400">
            TIFF is the {order.print_format?.colorspace ?? "press-ready"} file the printer expects
            {order.print_format?.preserve_alpha && ", with the die-cut transparency preserved"}. The
            PDF is a proof of the same artwork on white — use it to cross-check before committing
            stock.
          </p>

          <div className="space-y-2 pt-1">
            {noPrinters ? (
              <button
                onClick={() => run("DOWNLOAD", kind)}
                disabled={busy !== null}
                className="btn-primary w-full py-3"
              >
                {busy === "print" && <Spinner />}
                {isReprint ? `Re-download ${kind}` : `Download ${kind} & mark printed`}
              </button>
            ) : (
              <button
                onClick={() => run("PRINTER", kind)}
                disabled={busy !== null}
                className="btn-primary w-full py-3"
              >
                {busy === "print" && <Spinner />}
                {isReprint ? `Reprint ${kind}` : `Print ${kind}`}
              </button>
            )}
            <div className="grid grid-cols-2 gap-2">
              {!noPrinters && (
                <button
                  onClick={() => run("DOWNLOAD", kind)}
                  disabled={busy !== null}
                  className="btn-secondary"
                >
                  Download {kind}
                </button>
              )}
              <button
                onClick={() => run("PROOF", "PDF")}
                disabled={busy !== null}
                className={`btn-secondary ${noPrinters ? "col-span-2" : ""}`}
              >
                {busy === "proof" && <Spinner />}
                PDF proof only
              </button>
            </div>
          </div>

          {history.length > 0 && (
            <div className="pt-2">
              <p className="label">Job history</p>
              <ul className="scroll-slim max-h-40 space-y-1.5 overflow-y-auto pr-1">
                {history.map((job) => (
                  <li
                    key={job.id}
                    className="flex items-center justify-between gap-2 rounded-lg bg-cream px-3 py-2 text-xs"
                  >
                    <span className="font-bold">
                      #{job.id} {job.kind}
                      {job.is_reprint && <span className="ml-1 text-brand-500">reprint</span>}
                    </span>
                    <span className="text-ink-400">
                      {job.status === "SENT_TO_PRINTER" ? job.printer_name : job.status}
                    </span>
                    <span className="text-ink-400">{dateTime(job.created_at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
