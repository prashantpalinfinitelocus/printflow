"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  AdminApiError,
  adminGet as get,
  adminPost as post,
  sheetUrl,
  tiffUrl,
  todayInIndia,
  type CampaignDay,
  type CampaignWinner,
} from "@/lib/campaign/admin";
import { DESIGNS } from "@/lib/campaign/designs";
import { dateTime } from "@/lib/format";

import { CampaignDesigns } from "./CampaignDesigns";

/** The consumer-facing name of a design id: a built-in design's own name, or an added one's read from its id. */
const designName = (id: string) => {
  const builtin = DESIGNS.find((d) => d.id === id)?.name;
  if (builtin) return builtin;
  // An added design's id is its name in capitals (SUMMER_SPLASH), so read it back as words.
  const words = id.toLowerCase().replace(/_\d+$/, "").replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export function CampaignWinners({ initialDay }: { initialDay: string }) {
  const [day, setDay] = useState(initialDay);
  const [data, setData] = useState<CampaignDay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [drawing, setDrawing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [failures, setFailures] = useState<Record<number, string>>({});
  // The day on screen. An answer for any other day is stale (the picker moved on) and is dropped.
  const shownDay = useRef(initialDay);
  const mounted = useRef(true);

  // Set on every mount: StrictMode unmounts and remounts once, and a flag left false would stop every batch.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async (d: string) => {
    shownDay.current = d;
    setError(null);
    setFailures({});
    setLoading(true);
    try {
      const answer = await get<CampaignDay>(`/days/${d}`);
      if (shownDay.current === d) setData(answer);
    } catch (err) {
      if (shownDay.current !== d) return;
      setData(null);
      setError(err instanceof Error ? err.message : "Could not load this day");
    } finally {
      if (shownDay.current === d) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(day);
  }, [day, load]);

  async function runDraw() {
    setDrawing(true);
    setError(null);
    try {
      setData(await post<CampaignDay>(`/days/${day}/draw`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "The draw failed");
    } finally {
      setDrawing(false);
    }
  }

  const replaceWinner = (updated: CampaignWinner) =>
    setData((d) => d && { ...d, winners: d.winners.map((w) => (w.id === updated.id ? { ...w, ...updated } : w)) });

  // One request per TIFF: a whole day in one request could outlast the server's request timeout.
  async function generateTiffs(targets: CampaignWinner[]) {
    setProgress({ done: 0, total: targets.length });
    for (const [i, w] of targets.entries()) {
      // Leaving the page stops the batch rather than rendering on into an unmounted screen.
      if (!mounted.current) break;
      try {
        replaceWinner(await post<CampaignWinner>(`/winners/${w.id}/tiff`));
        setFailures(({ [w.id]: _, ...rest }) => rest);
      } catch (err) {
        if (err instanceof AdminApiError && err.status === 401) {
          setError("Your login has expired. Sign in again, then generate the remaining TIFFs.");
          break;
        }
        setFailures((f) => ({ ...f, [w.id]: err instanceof Error ? err.message : "TIFF failed" }));
      }
      setProgress({ done: i + 1, total: targets.length });
    }
    setProgress(null);
  }

  const missing = new Set(data?.missing_formats ?? []);
  const winners = data?.winners ?? [];
  const pending = winners.filter((w) => !w.tiff_ready && !missing.has(w.design_id));
  const ready = winners.filter((w) => w.tiff_ready).length;
  const busy = drawing || progress !== null;

  return (
    <div className="flex flex-col gap-4">
      <div className={`${CARD} flex flex-wrap items-end gap-3 px-5 py-4`}>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] leading-[13.2px] font-semibold text-[#F40009]">Draw day</span>
          {/* No future days: nothing has been entered for them yet. A typed one is ignored. */}
          <input
            type="date"
            className="h-11 rounded-[14px] border border-[#E8E8E8] px-4 text-base text-[#111111] outline-none focus:border-[#8A8A8A] disabled:opacity-50"
            value={day}
            max={todayInIndia()}
            disabled={busy}
            onChange={(e) => e.target.value && e.target.value <= todayInIndia() && setDay(e.target.value)}
          />
        </label>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {data?.can_draw && (
            <button onClick={runDraw} disabled={busy} className={PRIMARY}>
              {drawing ? <Spin /> : "Run draw"}
            </button>
          )}
          {pending.length > 0 && (
            <button onClick={() => generateTiffs(pending)} disabled={busy} className={PRIMARY}>
              Generate TIFFs ({pending.length})
            </button>
          )}
          {winners.length > 0 && (
            <a href={sheetUrl(day)} className={SECONDARY} download>
              Download sheet
            </a>
          )}
        </div>
      </div>

      {error && <Note kind="error">{error}</Note>}

      {loading && (
        <p className="flex items-center gap-2 px-1 text-sm text-[#8A8A8A]">
          <Spin /> Loading {day}…
        </p>
      )}

      {progress && (
        <Note kind="info">
          <span className="inline-flex items-center gap-2">
            <Spin /> Generating TIFF {Math.min(progress.done + 1, progress.total)} of {progress.total}…
          </span>
        </Note>
      )}

      {data && data.missing_formats.length > 0 && (
        <Note kind="warning">
          No PSD set up for {data.missing_formats.map((id) => `${designName(id)} (${id})`).join(", ")}, so those
          winners have no TIFF yet. Upload it under{" "}
          <a href="#designs" className="font-semibold underline underline-offset-2">
            Designs
          </a>{" "}
          below, then generate the TIFFs.
        </Note>
      )}

      {data && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Entries" value={data.entries} />
          <Stat label="Winners" value={data.draw?.winner_count ?? 0} accent />
          <Stat label="TIFFs ready" value={`${ready} / ${winners.length}`} />
          <Stat label="Drawn" value={data.draw ? dateTime(data.draw.created_at) : "—"} />
        </div>
      )}

      {data && !data.draw && !data.can_draw && (
        <Note kind="info">The draw runs after this day’s entries close at 10 PM IST.</Note>
      )}

      {data?.draw && (
        <div className={`${CARD} overflow-hidden`}>
          {winners.length === 0 ? (
            <p className="px-6 py-16 text-center text-sm">No winners: this day had no entries to draw from.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-left">
                <thead className="border-b border-[#EDEDED] bg-[#FAFAFA]">
                  <tr>
                    {["#", "Phone", "Email", "Design", "Text", "Entered", "TIFF"].map((h) => (
                      <th key={h} className={TH}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {winners.map((w) => (
                    <tr key={w.id} className="border-b border-[#EDEDED] last:border-0">
                      <td className={`${TD} font-bold text-black`}>{w.rank}</td>
                      <td className={`${TD} tabular-nums`}>{w.phone}</td>
                      <td className={TD}>{w.email}</td>
                      <td className={TD}>{designName(w.design_id)}</td>
                      <td className={`${TD} font-semibold text-black`}>{w.text}</td>
                      <td className={`${TD} text-[#8A8A8A]`}>{dateTime(w.entered_at)}</td>
                      <td className={TD}>
                        <TiffCell
                          winner={w}
                          noFormat={missing.has(w.design_id)}
                          failure={failures[w.id] ?? w.tiff_error}
                          busy={busy}
                          onGenerate={() => generateTiffs([w])}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <CampaignDesigns onSaved={() => void load(day)} />
    </div>
  );
}

/* The campaign site's look: white cards with a hairline border, black pills, red accents. */
const CARD = "rounded-2xl border border-[#EDEDED] bg-white";
const PRIMARY =
  "inline-flex h-10 items-center justify-center rounded-full bg-black px-5 text-sm font-semibold text-white transition active:scale-[0.99] disabled:opacity-50";
const SECONDARY =
  "inline-flex h-10 items-center justify-center rounded-full border border-black px-5 text-sm font-semibold text-black transition active:scale-[0.99]";
const SMALL_SECONDARY =
  "inline-flex h-8 items-center justify-center rounded-full border border-black px-4 text-xs font-semibold text-black disabled:opacity-50";
const TH = "px-4 py-3 text-[10px] leading-3 font-semibold tracking-[1.6px] text-[#8A8A8A] uppercase";
const TD = "px-4 py-3 text-sm";

function Spin() {
  return <span aria-hidden className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />;
}

function Stat({ label, value, accent = false }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className={`${CARD} px-5 py-4`}>
      <p className="text-[10px] leading-3 font-semibold tracking-[1.6px] text-[#8A8A8A] uppercase">{label}</p>
      <p
        className={`mt-2 font-[family-name:var(--dc-headline)] text-[28px] leading-8 font-bold ${accent ? "text-[#F40009]" : "text-black"}`}
      >
        {value}
      </p>
    </div>
  );
}

function Note({ kind, children }: { kind: "error" | "warning" | "info"; children: React.ReactNode }) {
  const tone = {
    error: "border-[#F40009]/30 bg-[#F40009]/5 text-[#B00007]",
    warning: "border-[#F5C26B] bg-[#FFF8E8] text-[#7A4B00]",
    info: "border-[#EDEDED] bg-[#FAFAFA] text-[#494949]",
  }[kind];
  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm leading-[22px] ${tone}`} role={kind === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

function TiffCell({
  winner,
  noFormat,
  failure,
  busy,
  onGenerate,
}: {
  winner: CampaignWinner;
  noFormat: boolean;
  failure: string | null;
  busy: boolean;
  onGenerate: () => void;
}) {
  if (winner.tiff_ready) {
    return (
      <a href={tiffUrl(winner.id)} className={SMALL_SECONDARY} download>
        Download TIFF
      </a>
    );
  }
  if (noFormat) {
    return (
      <span className="rounded-full bg-[#FFF8E8] px-3 py-1 text-[11px] font-semibold text-[#7A4B00]">No PSD set up</span>
    );
  }
  return (
    <div className="flex flex-col items-start gap-1">
      <button onClick={onGenerate} disabled={busy} className={SMALL_SECONDARY}>
        {failure ? "Retry" : "Generate"}
      </button>
      {failure && <p className="max-w-[260px] text-xs text-[#B00007]">{failure}</p>}
    </div>
  );
}
