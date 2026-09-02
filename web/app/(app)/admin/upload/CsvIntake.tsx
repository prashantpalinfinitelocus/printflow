"use client";

import { useRef, useState, type DragEvent } from "react";

import { Banner, EmptyState, Spinner } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { get, post, upload } from "@/lib/client";
import type { CsvBatch, InboxFile, PrintFormat, Store } from "@/lib/types";

export function CsvIntake({
  initialInbox,
  initialBatches,
  stores,
  formats,
}: {
  initialInbox: InboxFile[];
  initialBatches: CsvBatch[];
  stores: Store[];
  formats: PrintFormat[];
}) {
  const [inbox, setInbox] = useState(initialInbox);
  const [batches, setBatches] = useState(initialBatches);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CsvBatch | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function refresh() {
    const [nextInbox, nextBatches] = await Promise.all([
      get<InboxFile[]>("/csv/inbox"),
      get<CsvBatch[]>("/csv/batches?limit=15"),
    ]);
    setInbox(nextInbox);
    setBatches(nextBatches);
  }

  async function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Only .csv files are accepted.");
      return;
    }
    setBusy("upload");
    setError(null);
    setResult(null);
    try {
      const batch = await upload<CsvBatch>("/csv/upload", file);
      setResult(batch);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function importFromInbox(filename: string) {
    setBusy(filename);
    setError(null);
    setResult(null);
    try {
      setResult(await post<CsvBatch>("/csv/import-from-inbox", { filename }));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(null);
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1.15fr_1fr]">
      <div className="space-y-5">
        {/* Drop zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`card flex flex-col items-center justify-center px-6 py-12 text-center transition ${
            dragging ? "border-brand-500 bg-brand-50" : ""
          }`}
        >
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-2xl">
            📄
          </div>
          <p className="text-lg font-black tracking-tight">Drop your orders CSV here</p>
          <p className="mt-1 max-w-sm text-sm text-ink-400">
            Rows are matched to stores and templates by code. Anything that does not match is
            skipped and listed below — the rest still imports.
          </p>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          <button
            className="btn-primary mt-5"
            onClick={() => fileInput.current?.click()}
            disabled={busy !== null}
          >
            {busy === "upload" && <Spinner />}
            Choose CSV file
          </button>
        </div>

        {error && <Banner kind="error">{error}</Banner>}

        {result && (
          <div className="card overflow-hidden">
            <header className="border-b border-cream-200 px-5 py-4">
              <h2 className="font-black tracking-tight">Import result — {result.filename}</h2>
            </header>
            <div className="grid grid-cols-3 divide-x divide-cream-200 border-b border-cream-200">
              {[
                ["Rows", result.total_rows, "text-ink"],
                ["Imported", result.imported, "text-emerald-600"],
                ["Skipped", result.skipped, "text-rose-600"],
              ].map(([label, value, tone]) => (
                <div key={String(label)} className="px-5 py-4 text-center">
                  <p className={`text-3xl font-black ${tone}`}>{value as number}</p>
                  <p className="text-[11px] font-black tracking-[0.1em] text-ink-400 uppercase">
                    {label as string}
                  </p>
                </div>
              ))}
            </div>
            {result.errors.length > 0 && (
              <ul className="scroll-slim max-h-64 divide-y divide-cream-200 overflow-y-auto">
                {result.errors.map((rowError, index) => (
                  <li key={index} className="flex gap-3 px-5 py-2.5 text-sm">
                    <span className="shrink-0 font-mono text-xs text-ink-400">
                      row {rowError.row}
                    </span>
                    <span className="shrink-0 font-bold">{rowError.order_ref ?? "—"}</span>
                    <span className="text-rose-700">{rowError.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Server inbox */}
        <div className="card overflow-hidden">
          <header className="flex items-center justify-between border-b border-cream-200 px-5 py-4">
            <div>
              <h2 className="font-black tracking-tight">Server inbox</h2>
              <p className="text-xs text-ink-400">
                Files dropped into <code className="font-mono">data/inbox/</code> on the API host
              </p>
            </div>
            <button onClick={() => void refresh()} className="btn-secondary btn-sm">
              ↻
            </button>
          </header>
          {inbox.length === 0 ? (
            <EmptyState title="Inbox is empty" hint="Copy a CSV into data/inbox/ to see it here." icon="📥" />
          ) : (
            <ul className="divide-y divide-cream-200">
              {inbox.map((file) => (
                <li key={file.name} className="flex items-center justify-between gap-3 px-5 py-3.5">
                  <div className="min-w-0">
                    <p className="truncate font-bold">{file.name}</p>
                    <p className="text-xs text-ink-400">
                      {(file.size / 1024).toFixed(1)} KB · {dateTime(file.modified)}
                    </p>
                  </div>
                  <button
                    onClick={() => void importFromInbox(file.name)}
                    disabled={busy !== null}
                    className="btn-secondary btn-sm shrink-0"
                  >
                    {busy === file.name && <Spinner />}
                    Import
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Reference column */}
      <div className="space-y-5">
        <div className="card overflow-hidden">
          <header className="border-b border-cream-200 px-5 py-4">
            <h2 className="font-black tracking-tight">Expected format</h2>
          </header>
          <div className="px-5 py-4">
            <pre className="scroll-slim overflow-x-auto rounded-xl bg-ink px-4 py-3 text-xs leading-relaxed text-cream">
{`order_id,store_id,amount,print_format,text
ORD-1001,${stores[0]?.code ?? "MUM01"},499.00,${formats[0]?.code ?? "GIFT_TAG"},"Happy Birthday, Riya!"`}
            </pre>
            <dl className="mt-4 space-y-2.5 text-sm">
              {[
                ["order_id", "Unique across the system. Duplicates are skipped."],
                ["store_id", "Must match a store code exactly."],
                ["amount", "Decimal. Shown in the queue, not printed."],
                ["print_format", "Must match a print format code (the PSD template)."],
                ["text", "The text stamped into the template's text box."],
              ].map(([field, meaning]) => (
                <div key={field} className="flex gap-3">
                  <dt className="w-28 shrink-0 font-mono text-xs font-bold text-brand-600">
                    {field}
                  </dt>
                  <dd className="text-ink-600">{meaning}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <div className="card overflow-hidden">
          <header className="border-b border-cream-200 px-5 py-4">
            <h2 className="font-black tracking-tight">Valid codes</h2>
          </header>
          <div className="grid grid-cols-2 gap-4 px-5 py-4 text-sm">
            <div>
              <p className="label">Stores</p>
              <ul className="space-y-1">
                {stores.map((store) => (
                  <li key={store.id} className="font-mono text-xs">
                    <span className={store.is_active ? "font-bold" : "text-ink-400 line-through"}>
                      {store.code}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="label">Print formats</p>
              <ul className="space-y-1">
                {formats.map((format) => (
                  <li key={format.id} className="font-mono text-xs">
                    <span className={format.is_active ? "font-bold" : "text-ink-400 line-through"}>
                      {format.code}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="card overflow-hidden">
          <header className="border-b border-cream-200 px-5 py-4">
            <h2 className="font-black tracking-tight">Import history</h2>
          </header>
          {batches.length === 0 ? (
            <EmptyState title="Nothing imported yet" icon="🗂" />
          ) : (
            <ul className="scroll-slim max-h-96 divide-y divide-cream-200 overflow-y-auto">
              {batches.map((batch) => (
                <li key={batch.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{batch.filename}</p>
                    <p className="text-xs text-ink-400">
                      {dateTime(batch.created_at)} · {batch.uploaded_by?.email ?? "system"}
                    </p>
                  </div>
                  <p className="shrink-0 text-xs">
                    <span className="font-black text-emerald-600">{batch.imported}</span>
                    <span className="text-ink-400"> / {batch.total_rows}</span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
