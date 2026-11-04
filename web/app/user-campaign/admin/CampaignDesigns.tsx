"use client";

import Image, { type StaticImageData } from "next/image";
import { useEffect, useState } from "react";

import { addedStickerUrl, adminGet, adminUpload, type CampaignDesign } from "@/lib/campaign/admin";
import { DESIGNS } from "@/lib/campaign/designs";

const SMALL_DARK = "inline-flex h-8 cursor-pointer items-center justify-center rounded-full bg-black px-4 text-xs font-semibold text-white disabled:opacity-50";
const SMALL_OUTLINE =
  "inline-flex h-8 cursor-pointer items-center justify-center rounded-full border border-black px-4 text-xs font-semibold text-black disabled:opacity-50";

/** How a design looks on this page: a built-in one's bundled art, or an added one's uploaded sticker. */
type Look = { name: string; sticker: StaticImageData | string };

function lookOf(design: CampaignDesign): Look {
  if (!design.builtin) return { name: design.name ?? design.design_id, sticker: addedStickerUrl(design.design_id, design.version) };
  const builtin = DESIGNS.find((d) => d.id === design.design_id);
  return { name: builtin?.name ?? design.design_id, sticker: builtin?.sticker ?? "" };
}

/**
 * The designs' print files: the nine built into the site and any an admin added. Each prints
 * from its own PSD, so uploading it here is all the TIFF step needs.
 */
export function CampaignDesigns({ onSaved }: { onSaved?: () => void }) {
  const [designs, setDesigns] = useState<CampaignDesign[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminGet<CampaignDesign[]>("/designs").then(setDesigns, (err) =>
      setError(err instanceof Error ? err.message : "Could not load the designs"),
    );
  }, []);

  const saved = (design: CampaignDesign) => {
    setDesigns((list) => list.map((d) => (d.design_id === design.design_id ? { ...d, ...design } : d)));
    onSaved?.();
  };

  return (
    <section id="designs" aria-labelledby="designs-title" className="flex scroll-mt-6 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="designs-title" className="font-[family-name:var(--dc-serif)] text-[28px] leading-9 text-[#F40009]">
          Designs
        </h2>
        <p className="max-w-2xl text-sm leading-[22px]">
          Each design prints from its own PSD: upload it here and the text starts on the can’s name line.
        </p>
      </div>
      {error && (
        <p className="rounded-2xl border border-[#F40009]/30 bg-[#F40009]/5 px-4 py-3 text-sm text-[#B00007]">{error}</p>
      )}
      <ul className="grid gap-3 lg:grid-cols-2">
        {designs.map((design) => (
          <DesignRow key={design.design_id} design={design} look={lookOf(design)} onSaved={saved} />
        ))}
      </ul>
    </section>
  );
}

function DesignRow({
  design,
  look,
  onSaved,
}: {
  design: CampaignDesign;
  look: Look;
  onSaved: (design: CampaignDesign) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const format = design.format;
  const id = design.design_id;

  // The server keeps a replaced PSD's text settings, and gives a new design the can's name line.
  async function uploadPsd(file: File) {
    setBusy(true);
    setError(null);
    try {
      onSaved(await adminUpload<CampaignDesign>(`/designs/${id}/psd`, file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      aria-label={look.name}
      className={`flex flex-col gap-3 rounded-2xl border border-[#EDEDED] bg-white p-4 ${design.active ? "" : "opacity-70"}`}
    >
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-[#EDEDED] p-1">
          {typeof look.sticker === "string" ? (
            // An uploaded sticker, already re-saved and shrunk by the API.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={look.sticker} alt={`${look.name} sticker`} className="h-full w-full object-contain" />
          ) : (
            <Image src={look.sticker} alt="" sizes="192px" className="h-full w-full object-contain" />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-black">
            {look.name}
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                format ? "bg-[#E9F7EF] text-[#1B7A43]" : "bg-[#FFF8E8] text-[#7A4B00]"
              }`}
            >
              {format ? "PSD ready" : "No PSD yet"}
            </span>
            {!design.active && (
              <span className="rounded-full bg-[#EDEDED] px-2.5 py-0.5 text-[11px] font-semibold text-[#494949]">Hidden</span>
            )}
          </p>
          <p className="text-[11px] tracking-[1px] text-[#8A8A8A] uppercase">
            {id}
            {!design.builtin && design.category ? ` · ${design.category} · added` : ""}
          </p>
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
        <label htmlFor={`psd-${id}`} className={`${format ? SMALL_OUTLINE : SMALL_DARK} ${busy ? "pointer-events-none opacity-50" : ""}`}>
          {busy ? "Working…" : format ? "Replace PSD" : "Upload PSD"}
        </label>
        <input
          id={`psd-${id}`}
          type="file"
          accept=".psd"
          aria-label={`Upload PSD for ${look.name}`}
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void uploadPsd(file);
          }}
        />
      </div>
      {error && <p className="text-xs text-[#B00007]">{error}</p>}
    </li>
  );
}
