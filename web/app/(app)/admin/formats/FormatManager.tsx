"use client";

import { useEffect, useRef, useState } from "react";

import { Banner, EmptyState, Modal, Spinner } from "@/components/ui";
import { del, get, patch, post, upload } from "@/lib/client";
import type {
  DetectPlaceholderResponse,
  FitText,
  Font,
  PageSize,
  PrintFormat,
} from "@/lib/types";

type Draft = {
  code: string;
  name: string;
  psd_path: string;
  width_px: number;
  height_px: number;
  dpi: number;
  x: number;
  y: number;
  w: number;
  h: number;
  text_layer_name: string;
  font_size: number;
  font_color: string;
  align: string;
  font_path: string;
  placeholder_color: string;
  colorspace: string;
  preserve_alpha: boolean;
  page_size: string;
  print_passes: number;
  white_passes: number;
  is_active: boolean;
};

const EMPTY: Draft = {
  code: "",
  name: "",
  psd_path: "",
  width_px: 0,
  height_px: 0,
  dpi: 300,
  x: 0,
  y: 0,
  w: 0,
  h: 0,
  text_layer_name: "",
  font_size: 64,
  font_color: "#111111",
  align: "center",
  font_path: "",
  placeholder_color: "",
  colorspace: "",
  preserve_alpha: false,
  page_size: "",
  print_passes: 1,
  white_passes: 0,
  is_active: true,
};

/** Scaled schematic of where the text lands on the canvas. */
function BoxPreview({ draft }: { draft: Draft }) {
  if (!draft.width_px || !draft.height_px) return null;
  const scale = 220 / Math.max(draft.width_px, draft.height_px);
  const cw = draft.width_px * scale;
  const ch = draft.height_px * scale;

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="relative rounded-lg border border-ink/15 bg-cream-200"
        style={{ width: cw, height: ch }}
      >
        <div
          className="absolute rounded-sm border-2 border-dashed border-brand-500 bg-brand-500/12"
          style={{
            left: draft.x * scale,
            top: draft.y * scale,
            width: Math.max(2, draft.w * scale),
            height: Math.max(2, draft.h * scale),
          }}
        />
      </div>
      <p className="text-[11px] text-ink-400">
        {draft.width_px}×{draft.height_px}px ·{" "}
        {(draft.width_px / draft.dpi * 25.4).toFixed(0)}×
        {(draft.height_px / draft.dpi * 25.4).toFixed(0)}mm @ {draft.dpi}dpi
      </p>
    </div>
  );
}

export function FormatManager({ initial }: { initial: PrintFormat[] }) {
  const [formats, setFormats] = useState(initial);
  const [editing, setEditing] = useState<PrintFormat | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState<string | null>(null);
  const [fonts, setFonts] = useState<Font[]>([]);
  const [pageSizes, setPageSizes] = useState<PageSize[]>([]);
  const [fit, setFit] = useState<FitText | null>(null);
  const [sampleText, setSampleText] = useState("Sample Name");
  const psdInput = useRef<HTMLInputElement>(null);
  const fontInput = useRef<HTMLInputElement>(null);

  const refresh = async () => setFormats(await get<PrintFormat[]>("/print-formats"));
  const refreshFonts = async () => setFonts(await get<Font[]>("/print-formats/fonts"));

  useEffect(() => {
    void refreshFonts().catch(() => setFonts([]));
    void get<PageSize[]>("/print-formats/page-sizes")
      .then(setPageSizes)
      .catch(() => setPageSizes([]));
  }, []);

  // The size the renderer will actually use. font_size is a ceiling it shrinks
  // from, so without this an admin sets 400, sees no change, and concludes the
  // field is broken — which is exactly what happened.
  useEffect(() => {
    if (!draft.w || !draft.h) {
      setFit(null);
      return;
    }
    const timer = setTimeout(() => {
      void post<FitText>("/print-formats/fit-text", {
        text_box: { x: draft.x, y: draft.y, w: draft.w, h: draft.h },
        font_size: draft.font_size,
        font_path: draft.font_path || null,
        text: sampleText || "Sample Name",
        dpi: draft.dpi || 300,
      })
        .then(setFit)
        .catch(() => setFit(null));
    }, 250);
    return () => clearTimeout(timer);
  }, [
    draft.x,
    draft.y,
    draft.w,
    draft.h,
    draft.font_size,
    draft.font_path,
    draft.dpi,
    sampleText,
  ]);

  function openCreate() {
    setDraft(EMPTY);
    setEditing(null);
    setError(null);
    setDetected(null);
    setCreating(true);
  }

  function openEdit(format: PrintFormat) {
    setDraft({
      code: format.code,
      name: format.name,
      psd_path: format.psd_path,
      width_px: format.width_px,
      height_px: format.height_px,
      dpi: format.dpi,
      x: format.text_box?.x ?? 0,
      y: format.text_box?.y ?? 0,
      w: format.text_box?.w ?? 0,
      h: format.text_box?.h ?? 0,
      text_layer_name: format.text_layer_name ?? "",
      font_size: format.font_size,
      font_color: format.font_color,
      align: format.align,
      font_path: format.font_path ?? "",
      placeholder_color: format.placeholder_color ?? "",
      colorspace: format.colorspace ?? "",
      preserve_alpha: format.preserve_alpha,
      page_size: format.page_size ?? "",
      print_passes: format.print_passes ?? 1,
      white_passes: format.white_passes ?? 0,
      is_active: format.is_active,
    });
    setError(null);
    setDetected(null);
    setEditing(format);
  }

  async function handlePsd(file: File) {
    setUploading(true);
    setError(null);
    try {
      const info = await upload<{ psd_path: string; width_px: number; height_px: number }>(
        "/print-formats/upload-psd",
        file,
      );
      setDraft((current) => ({
        ...current,
        psd_path: info.psd_path,
        width_px: info.width_px,
        height_px: info.height_px,
        // Default the text box to the middle band — a sane starting point to nudge.
        x: Math.round(info.width_px * 0.1),
        y: Math.round(info.height_px * 0.4),
        w: Math.round(info.width_px * 0.8),
        h: Math.round(info.height_px * 0.25),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "PSD upload failed");
    } finally {
      setUploading(false);
      if (psdInput.current) psdInput.current.value = "";
    }
  }

  async function handleFont(file: File) {
    setUploading(true);
    setError(null);
    try {
      const info = await upload<Font>("/print-formats/upload-font", file);
      await refreshFonts();
      setDraft((current) => ({ ...current, font_path: info.filename }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Font upload failed");
    } finally {
      setUploading(false);
      if (fontInput.current) fontInput.current.value = "";
    }
  }

  /** Find the placeholder baked into the artwork and snap the box onto it. */
  async function detectBox() {
    setDetecting(true);
    setError(null);
    setDetected(null);
    try {
      const res = await post<DetectPlaceholderResponse>("/print-formats/detect-placeholder", {
        psd_path: draft.psd_path,
        color: draft.placeholder_color || "#ED1C24",
        // Match a box the size of the one already set, so re-detecting after a
        // manual nudge finds the same run of letters instead of stray artwork.
        expected_w: draft.w || null,
        expected_h: draft.h || null,
      });
      const { x, y, w, h } = res.text_box;
      setDraft((current) => ({ ...current, x, y, w, h }));
      setDetected(`Found a ${w}×${h}px placeholder at ${x},${y} — ${(res.fill * 100).toFixed(0)}% filled.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Detection failed");
    } finally {
      setDetecting(false);
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    const textBox = { x: draft.x, y: draft.y, w: draft.w, h: draft.h };
    try {
      if (editing) {
        await patch<PrintFormat>(`/print-formats/${editing.id}`, {
          name: draft.name,
          psd_path: draft.psd_path,
          text_box: textBox,
          text_layer_name: draft.text_layer_name || null,
          font_size: draft.font_size,
          font_color: draft.font_color,
          align: draft.align,
          dpi: draft.dpi,
          font_path: draft.font_path || null,
          placeholder_color: draft.placeholder_color || null,
          colorspace: draft.colorspace || null,
          preserve_alpha: draft.preserve_alpha,
          page_size: draft.page_size || null,
          print_passes: draft.print_passes,
          white_passes: draft.white_passes,
          is_active: draft.is_active,
        });
      } else {
        await post<PrintFormat>("/print-formats", {
          code: draft.code,
          name: draft.name,
          psd_path: draft.psd_path,
          text_box: textBox,
          text_layer_name: draft.text_layer_name || null,
          dpi: draft.dpi,
          font_size: draft.font_size,
          font_color: draft.font_color,
          align: draft.align,
          font_path: draft.font_path || null,
          placeholder_color: draft.placeholder_color || null,
          colorspace: draft.colorspace || null,
          preserve_alpha: draft.preserve_alpha,
          page_size: draft.page_size || null,
          print_passes: draft.print_passes,
          white_passes: draft.white_passes,
          is_active: draft.is_active,
        });
      }
      await refresh();
      setEditing(null);
      setCreating(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(format: PrintFormat) {
    setPageError(null);
    try {
      await patch<PrintFormat>(`/print-formats/${format.id}`, { is_active: !format.is_active });
      await refresh();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Update failed");
    }
  }

  async function remove(format: PrintFormat) {
    if (!confirm(`Delete format ${format.code}?`)) return;
    setPageError(null);
    try {
      await del(`/print-formats/${format.id}`);
      await refresh();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  const open = creating || editing !== null;
  const canSave =
    draft.name.trim() !== "" &&
    draft.psd_path !== "" &&
    draft.w > 0 &&
    draft.h > 0 &&
    (editing !== null || draft.code.trim() !== "");

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={openCreate} className="btn-primary btn-sm">
          + New format
        </button>
      </div>

      {pageError && <Banner kind="error">{pageError}</Banner>}

      {formats.length === 0 ? (
        <div className="card">
          <EmptyState title="No print formats" hint="Upload a PSD to create your first template." icon="🎨" />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {formats.map((format) => (
            <article key={format.id} className="card flex flex-col overflow-hidden">
              <header className="flex items-start justify-between gap-3 border-b border-cream-200 px-5 py-4">
                <div className="min-w-0">
                  <p className="font-mono text-xs font-black text-brand-600">{format.code}</p>
                  <h3 className="truncate font-black tracking-tight">{format.name}</h3>
                </div>
                <span
                  className={`chip shrink-0 ${
                    format.is_active ? "bg-emerald-100 text-emerald-800" : "bg-cream-200 text-ink-400"
                  }`}
                >
                  {format.is_active ? "Active" : "Off"}
                </span>
              </header>

              <div className="flex flex-1 gap-4 px-5 py-4">
                <BoxPreview
                  draft={{
                    ...EMPTY,
                    width_px: format.width_px,
                    height_px: format.height_px,
                    dpi: format.dpi,
                    x: format.text_box?.x ?? 0,
                    y: format.text_box?.y ?? 0,
                    w: format.text_box?.w ?? 0,
                    h: format.text_box?.h ?? 0,
                  }}
                />
                <dl className="flex-1 space-y-1.5 text-xs">
                  <div>
                    <dt className="text-ink-400">PSD</dt>
                    <dd className="truncate font-mono font-bold">{format.psd_path}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-400">Text box</dt>
                    <dd className="font-mono font-bold">
                      {format.text_box?.x},{format.text_box?.y} · {format.text_box?.w}×
                      {format.text_box?.h}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-400">Type</dt>
                    <dd className="flex items-center gap-1.5 font-bold">
                      <span
                        className="inline-block h-3 w-3 rounded-full border border-ink/15"
                        style={{ background: format.font_color }}
                      />
                      {format.font_size}px · {format.align}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-400">Output</dt>
                    <dd className="font-bold">
                      {format.colorspace ?? "default"} @ {format.dpi}dpi
                      {format.preserve_alpha && " · transparent"}
                      {format.page_size ? ` · on ${format.page_size}` : " · label only"}
                      {format.print_passes > 1 && ` · ${format.print_passes}× passes`}
                      {format.white_passes > 0 && ` · ${format.white_passes}× white`}
                    </dd>
                  </div>
                  {format.font_path && (
                    <div>
                      <dt className="text-ink-400">Font</dt>
                      <dd className="truncate font-mono font-bold">{format.font_path}</dd>
                    </div>
                  )}
                </dl>
              </div>

              <footer className="flex gap-1.5 border-t border-cream-200 px-4 py-2.5">
                <button onClick={() => openEdit(format)} className="btn-ghost btn-sm">
                  Edit
                </button>
                <button onClick={() => toggleActive(format)} className="btn-ghost btn-sm">
                  {format.is_active ? "Deactivate" : "Activate"}
                </button>
                <button
                  onClick={() => remove(format)}
                  className="btn-ghost btn-sm ml-auto text-brand-500 hover:bg-brand-50"
                >
                  Delete
                </button>
              </footer>
            </article>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        width="max-w-2xl"
        title={editing ? `Edit ${editing.code}` : "New print format"}
        subtitle="Coordinates are pixels from the top-left of the PSD canvas."
      >
        <div className="space-y-4">
          {error && <Banner kind="error">{error}</Banner>}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="fmt-code">
                Code
              </label>
              <input
                id="fmt-code"
                className="input font-mono uppercase"
                placeholder="GIFT_TAG"
                value={draft.code}
                disabled={editing !== null}
                onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
              />
            </div>
            <div>
              <label className="label" htmlFor="fmt-name">
                Name
              </label>
              <input
                id="fmt-name"
                className="input"
                placeholder="Gift Tag 100x150mm"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
          </div>

          <div>
            <span className="label">PSD template</span>
            <div className="flex items-center gap-3">
              <input
                ref={psdInput}
                type="file"
                accept=".psd"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handlePsd(file);
                }}
              />
              <button
                className="btn-secondary btn-sm"
                onClick={() => psdInput.current?.click()}
                disabled={uploading}
              >
                {uploading && <Spinner />}
                {draft.psd_path ? "Replace PSD" : "Upload PSD"}
              </button>
              <span className="truncate font-mono text-xs text-ink-400">
                {draft.psd_path || "No file selected"}
              </span>
            </div>
          </div>

          {draft.width_px > 0 && (
            <div className="space-y-3 rounded-xl border border-cream-200 bg-cream p-4">
              <div className="flex flex-wrap gap-6">
                <BoxPreview draft={draft} />
                <div className="grid flex-1 grid-cols-2 gap-3">
                  {(
                    [
                      ["x", "Box X"],
                      ["y", "Box Y"],
                      ["w", "Box width"],
                      ["h", "Box height"],
                    ] as const
                  ).map(([key, label]) => (
                    <div key={key}>
                      <label className="label" htmlFor={`fmt-${key}`}>
                        {label}
                      </label>
                      <input
                        id={`fmt-${key}`}
                        type="number"
                        className="input"
                        value={draft[key]}
                        onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) || 0 })}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-3 border-t border-cream-200 pt-3">
                <div className="w-36">
                  <label className="label" htmlFor="fmt-placeholder">
                    Placeholder colour
                  </label>
                  <input
                    id="fmt-placeholder"
                    className="input font-mono"
                    placeholder="#ED1C24"
                    value={draft.placeholder_color}
                    onChange={(e) => setDraft({ ...draft, placeholder_color: e.target.value })}
                  />
                </div>
                <button className="btn-secondary btn-sm" onClick={detectBox} disabled={detecting}>
                  {detecting && <Spinner />}
                  Detect from artwork
                </button>
                <p className="flex-1 text-xs text-ink-400">
                  The colour of the dummy text baked into the design (the red XXXXXXXX). It is wiped
                  before the order text is drawn, and Detect snaps the box onto it.
                </p>
              </div>
              {detected && <Banner kind="success">{detected}</Banner>}
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label" htmlFor="fmt-size">
                Font size (max)
              </label>
              <input
                id="fmt-size"
                type="number"
                className="input"
                value={draft.font_size}
                onChange={(e) => setDraft({ ...draft, font_size: Number(e.target.value) || 12 })}
              />
              <p className="mt-1 text-[11px] text-ink-400">
                = {(draft.font_size / ((draft.dpi || 300) / 72)).toFixed(1)} pt at {draft.dpi}dpi
              </p>
            </div>
            <div>
              <label className="label" htmlFor="fmt-color">
                Colour
              </label>
              <input
                id="fmt-color"
                type="color"
                className="input h-[42px] p-1"
                value={draft.font_color}
                onChange={(e) => setDraft({ ...draft, font_color: e.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="fmt-align">
                Align
              </label>
              <select
                id="fmt-align"
                className="input"
                value={draft.align}
                onChange={(e) => setDraft({ ...draft, align: e.target.value })}
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </div>
          </div>

          {/* What the renderer will actually use. Font size is a ceiling it
              shrinks from, and the box is usually the real constraint. */}
          <div className="rounded-xl border border-cream-200 bg-cream px-4 py-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-[9rem]">
                <label className="label" htmlFor="fmt-sample">
                  Test with
                </label>
                <input
                  id="fmt-sample"
                  className="input"
                  value={sampleText}
                  placeholder="Longest name you expect"
                  onChange={(e) => setSampleText(e.target.value)}
                />
              </div>
              <div className="text-right">
                <p className="label">Actual size</p>
                {fit ? (
                  <>
                    <p className="text-lg leading-tight font-bold">
                      {fit.font_size_used_pt} pt
                      {fit.lines > 1 && (
                        <span className="text-sm font-normal text-ink-400">
                          {" "}
                          · {fit.lines} lines
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-ink-400">
                      {fit.font_size_used}px · {fit.line_height_mm}mm line
                    </p>
                  </>
                ) : (
                  <p className="text-lg leading-tight font-bold text-ink-400">—</p>
                )}
              </div>
            </div>
            {fit && (
              <p className="mt-2 text-xs text-ink-400">
                {fit.capped ? (
                  <>
                    <strong className="text-brand-600">
                      The box caps this at {fit.font_size_used_pt} pt
                    </strong>{" "}
                    — you asked for {fit.requested_pt} pt, and raising{" "}
                    <strong>Font size</strong> further changes nothing. To reach{" "}
                    {fit.requested_pt} pt this name needs a box of at least{" "}
                    <strong>
                      {fit.min_box_width}×{fit.min_box_height}px
                    </strong>
                    ; it is {draft.w}×{draft.h} now.
                  </>
                ) : (
                  <>
                    Fits at the full {fit.requested_pt} pt. Font size is a maximum in pixels — the
                    renderer shrinks it until the text fits the box.
                  </>
                )}
                {fit.lines > 1 && (
                  <>
                    {" "}
                    This name wraps onto {fit.lines} lines, which is what dropped the size — widen
                    the box to keep it on one.
                  </>
                )}
              </p>
            )}
            {fit?.capped && (
              <button
                type="button"
                className="btn-secondary btn-sm mt-2.5"
                onClick={() =>
                  setDraft({
                    ...draft,
                    // Grow around the box's own centre so the text stays where
                    // the placeholder is rather than drifting down the artwork.
                    x: Math.max(0, Math.round(draft.x + draft.w / 2 - Math.max(draft.w, fit.min_box_width) / 2)),
                    y: Math.max(0, Math.round(draft.y + draft.h / 2 - Math.max(draft.h, fit.min_box_height) / 2)),
                    w: Math.max(draft.w, fit.min_box_width),
                    h: Math.max(draft.h, fit.min_box_height),
                  })
                }
              >
                Grow box to fit {fit.requested_pt} pt
              </button>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label" htmlFor="fmt-font">
                Font
              </label>
              <div className="flex gap-1.5">
                <select
                  id="fmt-font"
                  className="input min-w-0 flex-1"
                  value={draft.font_path}
                  onChange={(e) => setDraft({ ...draft, font_path: e.target.value })}
                >
                  <option value="">Automatic</option>
                  {fonts.map((font) => (
                    <option key={font.filename} value={font.filename}>
                      {font.family ?? font.filename}
                    </option>
                  ))}
                </select>
                <input
                  ref={fontInput}
                  type="file"
                  accept=".ttf,.otf,.ttc"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleFont(file);
                  }}
                />
                <button
                  className="btn-secondary btn-sm shrink-0"
                  onClick={() => fontInput.current?.click()}
                  disabled={uploading}
                  title="Upload a font file"
                >
                  +
                </button>
              </div>
            </div>
            <div>
              <label className="label" htmlFor="fmt-colorspace">
                Output colour
              </label>
              <select
                id="fmt-colorspace"
                className="input"
                value={draft.colorspace}
                onChange={(e) => setDraft({ ...draft, colorspace: e.target.value })}
              >
                <option value="">Server default</option>
                <option value="RGB">RGB</option>
                <option value="CMYK">CMYK</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="fmt-dpi">
                DPI
              </label>
              <input
                id="fmt-dpi"
                type="number"
                className="input"
                value={draft.dpi}
                onChange={(e) => setDraft({ ...draft, dpi: Number(e.target.value) || 300 })}
              />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="fmt-page-size">
              Print on
            </label>
            <select
              id="fmt-page-size"
              className="input"
              value={draft.page_size}
              onChange={(e) => setDraft({ ...draft, page_size: e.target.value })}
            >
              <option value="">Label only (no page)</option>
              {pageSizes.map((size) => (
                <option key={size.name} value={size.name}>
                  {size.name} — {size.width_in}×{size.height_in} in
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-ink-400">
              The paper this store loads. The label is centred on that sheet at true size, so
              the operator&apos;s &ldquo;fit to page&rdquo; has nothing left to scale.{" "}
              <strong>Label only</strong> emits a label-sized file, which most print dialogs
              enlarge to fill the paper and crop into the artwork.
            </p>
          </div>

          <div>
            <label className="label" htmlFor="fmt-passes">
              Passes per object
            </label>
            <input
              id="fmt-passes"
              type="number"
              min={1}
              max={10}
              className="input"
              value={draft.print_passes}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  print_passes: Math.min(10, Math.max(1, Number(e.target.value) || 1)),
                })
              }
            />
            <p className="mt-1.5 text-xs text-ink-400">
              How many times this design is printed onto the <strong>same</strong> can or bottle
              without it leaving the jig. One pass of light ink on aluminium or glass goes down
              translucent and the substrate&apos;s own artwork reads through it; 2–3 passes build
              opacity. Counts as <strong>one</strong> print, not a reprint.
              {draft.print_passes > 1 && draft.white_passes > 0 && (
                <span className="mt-1 block font-bold text-brand-600">
                  White passes are set too. Building opacity in the white plates is the
                  printer&apos;s own mechanism — one pass over the can instead of{" "}
                  {draft.print_passes}. Consider dropping this back to 1.
                </span>
              )}
            </p>
          </div>

          <div>
            <label className="label" htmlFor="fmt-white">
              White passes
            </label>
            <input
              id="fmt-white"
              type="number"
              min={0}
              max={6}
              className="input"
              value={draft.white_passes}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  white_passes: Math.min(6, Math.max(0, Number(e.target.value) || 0)),
                })
              }
            />
            <p className="mt-1.5 text-xs text-ink-400">
              Passes of white ink laid under the artwork, written into the TIFF as spot channels
              the UV press reads. <strong>0</strong> emits a plain file — correct for anything not
              going to that press. <strong>1</strong> gives the <code>W1</code>/<code>W2</code>{" "}
              pair; each further pass appends another <code>W1</code>.
              {draft.white_passes > 0 && (
                <span className="mt-1 block font-bold text-ink">
                  Channels:{" "}
                  {["W1", "W2", ...Array(Math.max(0, draft.white_passes - 1)).fill("W1")].join(
                    ", ",
                  )}
                </span>
              )}
              {draft.white_passes > 0 && draft.colorspace === "CMYK" && (
                <span className="mt-1 block font-bold text-brand-600">
                  CMYK cannot carry spot channels or the transparency they come from — RGB is used
                  when both are set.
                </span>
              )}
            </p>
          </div>

          <label className="flex items-start gap-2.5 text-sm font-bold">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[var(--color-brand-500)]"
              checked={draft.preserve_alpha}
              onChange={(e) => setDraft({ ...draft, preserve_alpha: e.target.checked })}
            />
            <span>
              Keep transparency
              <span className="block text-xs font-normal text-ink-400">
                Required for die-cut labels — without it the artwork prints on a white rectangle.
                CMYK cannot carry transparency, so RGB is used when both are set.
              </span>
            </span>
          </label>

          <div>
            <label className="label" htmlFor="fmt-layer">
              Placeholder layer name (optional)
            </label>
            <input
              id="fmt-layer"
              className="input font-mono"
              placeholder="e.g. TEXT_AREA"
              value={draft.text_layer_name}
              onChange={(e) => setDraft({ ...draft, text_layer_name: e.target.value })}
            />
            <p className="mt-1 text-xs text-ink-400">
              If your PSD has a layer with this name, it is hidden during composition and its bounds
              are used when no box is set above.
            </p>
          </div>

          <label className="flex items-center gap-2.5 text-sm font-bold">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--color-brand-500)]"
              checked={draft.is_active}
              onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })}
            />
            Active — inactive formats are rejected during CSV import
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button
              className="btn-secondary"
              onClick={() => {
                setCreating(false);
                setEditing(null);
              }}
            >
              Cancel
            </button>
            <button className="btn-primary" onClick={save} disabled={busy || !canSave}>
              {busy && <Spinner />}
              {editing ? "Save changes" : "Create format"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
