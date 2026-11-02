"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

import {
  adminGet,
  adminPatch,
  adminPost,
  adminUpload,
  type CampaignDesign,
  type DesignFormat,
  type Font,
  type TextBox,
} from "@/lib/campaign/admin";
import { DESIGNS, type CanDesign } from "@/lib/campaign/designs";

/** The red XXXXXXXX placeholder some PSDs carry; the renderer erases it before printing the text. */
const PLACEHOLDER_RED = "#ED1C24";

/**
 * The campaign's nine designs and the PSD each one prints from. A winner's TIFF is
 * rendered from its design's PSD and text settings, so setting a design up here is
 * all the TIFF step needs.
 */
export function CampaignDesigns({ onSaved }: { onSaved?: () => void }) {
  const [formats, setFormats] = useState<Record<string, DesignFormat | null>>({});
  const [fonts, setFonts] = useState<Font[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([adminGet<CampaignDesign[]>("/designs"), adminGet<Font[]>("/fonts")])
      .then(([designs, available]) => {
        setFormats(Object.fromEntries(designs.map((d) => [d.design_id, d.format])));
        setFonts(available);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load the designs"));
  }, []);

  const saved = (design: CampaignDesign) => {
    setFormats((f) => ({ ...f, [design.design_id]: design.format }));
    onSaved?.();
  };

  return (
    <section id="designs" aria-labelledby="designs-title" className="flex scroll-mt-6 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="designs-title" className="font-[family-name:var(--dc-serif)] text-[28px] leading-9 text-[#F40009]">
          Designs
        </h2>
        <p className="max-w-2xl text-sm leading-[22px]">
          Each design prints from its own PSD. Upload it here and the text starts on the can’s name line. If the PSD
          has a red XXXXXXXX placeholder, find it under Edit text settings. Then generate the winners’ TIFFs above.
        </p>
      </div>
      {error && (
        <p className="rounded-2xl border border-[#F40009]/30 bg-[#F40009]/5 px-4 py-3 text-sm text-[#B00007]">{error}</p>
      )}
      <ul className="grid gap-3 lg:grid-cols-2">
        {DESIGNS.map((design) => (
          <DesignRow key={design.id} design={design} format={formats[design.id] ?? null} fonts={fonts} onSaved={saved} />
        ))}
      </ul>
    </section>
  );
}

function DesignRow({
  design,
  format,
  fonts,
  onSaved,
}: {
  design: CanDesign;
  format: DesignFormat | null;
  fonts: Font[];
  onSaved: (design: CampaignDesign) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  // The server keeps a replaced PSD's text settings, and gives a new design the can's name line.
  // No colour search here: Diet Coke art is mostly red, and a search could take the logo for the placeholder.
  async function uploadPsd(file: File) {
    setBusy(true);
    setError(null);
    try {
      onSaved(await adminUpload<CampaignDesign>(`/designs/${design.id}/psd`, file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  const inputId = `psd-${design.id}`;
  return (
    <li aria-label={design.name} className="flex flex-col gap-3 rounded-2xl border border-[#EDEDED] bg-white p-4">
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-[#EDEDED] p-1">
          <Image src={design.sticker} alt="" sizes="64px" className="h-full w-full object-contain" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-black">
            {design.name}
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                format ? "bg-[#E9F7EF] text-[#1B7A43]" : "bg-[#FFF8E8] text-[#7A4B00]"
              }`}
            >
              {format ? "PSD ready" : "No PSD yet"}
            </span>
          </p>
          <p className="text-[11px] tracking-[1px] text-[#8A8A8A] uppercase">{design.id}</p>
          {format && (
            <>
              <p className="truncate text-xs">{format.psd_path}</p>
              <p className="text-xs text-[#8A8A8A]">
                {format.width_px} × {format.height_px} px · {format.dpi} dpi · text at {format.text_box.x},
                {format.text_box.y} ({format.text_box.w} × {format.text_box.h}) · {format.font_path ?? "automatic font"} ·{" "}
                {format.font_size}px
              </p>
            </>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor={inputId}
          className={`inline-flex h-8 cursor-pointer items-center justify-center rounded-full px-4 text-xs font-semibold ${
            format ? "border border-black text-black" : "bg-black text-white"
          } ${busy ? "pointer-events-none opacity-50" : ""}`}
        >
          {busy ? "Uploading…" : format ? "Replace PSD" : "Upload PSD"}
        </label>
        <input
          id={inputId}
          type="file"
          accept=".psd"
          aria-label={`Upload PSD for ${design.name}`}
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void uploadPsd(file);
          }}
        />
        {format && !editing && (
          <button
            onClick={() => setEditing(true)}
            className="inline-flex h-8 items-center rounded-full px-3 text-xs font-semibold underline underline-offset-2"
          >
            Edit text settings
          </button>
        )}
      </div>
      {error && <p className="text-xs text-[#B00007]">{error}</p>}
      {format && editing && (
        <TextSettings
          designId={design.id}
          format={format}
          fonts={fonts}
          onCancel={() => setEditing(false)}
          onSaved={(saved) => {
            onSaved(saved);
            setEditing(false);
          }}
        />
      )}
    </li>
  );
}

const FIELD = "h-10 w-full rounded-[12px] border border-[#E8E8E8] px-3 text-sm text-[#111111] outline-none focus:border-[#8A8A8A]";
const CAPTION = "text-[11px] leading-[13.2px] font-semibold text-[#F40009]";

function TextSettings({
  designId,
  format,
  fonts,
  onCancel,
  onSaved,
}: {
  designId: string;
  format: DesignFormat;
  fonts: Font[];
  onCancel: () => void;
  onSaved: (design: CampaignDesign) => void;
}) {
  const [box, setBox] = useState(format.text_box);
  const [fontPath, setFontPath] = useState(format.font_path ?? "");
  const [fontSize, setFontSize] = useState(String(format.font_size));
  const [color, setColor] = useState(format.font_color);
  const [erase, setErase] = useState(Boolean(format.placeholder_color));
  const [found, setFound] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function findPlaceholder() {
    setBusy(true);
    setError(null);
    setFound(null);
    try {
      const res = await adminPost<{ text_box: TextBox; fill: number }>(`/designs/${designId}/find-placeholder`, {
        color: PLACEHOLDER_RED,
        // Look for a run of letters the size of the current box, not any red in the art.
        expected_w: box.w,
        expected_h: box.h,
      });
      const { x, y, w, h } = res.text_box;
      setBox(res.text_box);
      setErase(true);
      setFound(`Found a ${w} × ${h} px placeholder at ${x},${y}. Check it is the XXXXXXXX before saving.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No placeholder found");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await adminPatch<CampaignDesign>(`/designs/${designId}`, {
          text_box: box,
          font_path: fontPath || null,
          font_size: Number(fontSize),
          font_color: color,
          placeholder_color: erase ? PLACEHOLDER_RED : null,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  const boxField = (key: keyof TextBox, label: string) => (
    <label className="flex flex-col gap-1">
      <span className={CAPTION}>{label}</span>
      <input
        type="number"
        min={0}
        className={FIELD}
        value={box[key]}
        onChange={(e) => setBox({ ...box, [key]: Number(e.target.value) })}
      />
    </label>
  );

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-[#FAFAFA] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs">Text box, in pixels from the PSD’s top-left corner.</p>
        <button
          onClick={findPlaceholder}
          disabled={busy}
          className="inline-flex h-8 items-center rounded-full border border-black px-3 text-xs font-semibold text-black disabled:opacity-50"
        >
          Find red XXXXXXXX placeholder
        </button>
      </div>
      {found && <p className="text-xs text-[#1B7A43]">{found}</p>}
      <div className="grid grid-cols-4 gap-2">
        {boxField("x", "Left")}
        {boxField("y", "Top")}
        {boxField("w", "Width")}
        {boxField("h", "Height")}
      </div>
      <div className="grid grid-cols-[1fr_auto_auto] gap-2">
        <label className="flex flex-col gap-1">
          <span className={CAPTION}>Font</span>
          <select className={FIELD} value={fontPath} onChange={(e) => setFontPath(e.target.value)}>
            <option value="">Automatic</option>
            {fonts.map((f) => (
              <option key={f.filename} value={f.filename}>
                {f.filename}
              </option>
            ))}
          </select>
        </label>
        <label className="flex w-28 flex-col gap-1">
          <span className={CAPTION}>Font size (px)</span>
          <input type="number" min={1} className={FIELD} value={fontSize} onChange={(e) => setFontSize(e.target.value)} />
        </label>
        <label className="flex w-24 flex-col gap-1">
          <span className={CAPTION}>Colour</span>
          <input type="color" className={`${FIELD} p-1`} value={color} onChange={(e) => setColor(e.target.value)} />
        </label>
      </div>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={erase} onChange={(e) => setErase(e.target.checked)} className="accent-black" />
        Erase the red placeholder before printing
      </label>
      {error && <p className="text-xs text-[#B00007]">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={busy}
          className="inline-flex h-8 items-center justify-center rounded-full bg-black px-4 text-xs font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          onClick={onCancel}
          className="inline-flex h-8 items-center rounded-full px-3 text-xs font-semibold underline underline-offset-2"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
