"use client";

import Image, { type StaticImageData } from "next/image";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import {
  addedStickerUrl,
  adminDelete,
  adminGet,
  adminPatch,
  adminPost,
  adminUpload,
  type CampaignDesign,
  type DesignFormat,
  type Font,
  type TextBox,
} from "@/lib/campaign/admin";
import { CATEGORIES, DESIGNS } from "@/lib/campaign/designs";

/** The red XXXXXXXX placeholder some PSDs carry; the renderer erases it before printing the text. */
const PLACEHOLDER_RED = "#ED1C24";

const SMALL_DARK = "inline-flex h-8 cursor-pointer items-center justify-center rounded-full bg-black px-4 text-xs font-semibold text-white disabled:opacity-50";
const SMALL_OUTLINE =
  "inline-flex h-8 cursor-pointer items-center justify-center rounded-full border border-black px-4 text-xs font-semibold text-black disabled:opacity-50";
const SMALL_LINK = "inline-flex h-8 items-center rounded-full px-3 text-xs font-semibold underline underline-offset-2 disabled:opacity-50";

/** How a design looks on this page: a built-in one's bundled art, or an added one's uploaded sticker. */
type Look = { name: string; sticker: StaticImageData | string };

function lookOf(design: CampaignDesign): Look {
  if (!design.builtin) return { name: design.name ?? design.design_id, sticker: addedStickerUrl(design.design_id, design.version) };
  const builtin = DESIGNS.find((d) => d.id === design.design_id);
  return { name: builtin?.name ?? design.design_id, sticker: builtin?.sticker ?? "" };
}

/**
 * The designs users pick from: the nine built into the site and any an admin added. Each prints
 * from its own PSD, so setting a design up here is all the TIFF step needs. Any design can be
 * hidden from users; an added one nobody has entered with can also be deleted.
 */
export function CampaignDesigns({ onSaved }: { onSaved?: () => void }) {
  const [designs, setDesigns] = useState<CampaignDesign[]>([]);
  const [fonts, setFonts] = useState<Font[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setDesigns(await adminGet<CampaignDesign[]>("/designs"));
  }, []);

  useEffect(() => {
    Promise.all([reload(), adminGet<Font[]>("/fonts").then(setFonts)]).catch((err) =>
      setError(err instanceof Error ? err.message : "Could not load the designs"),
    );
  }, [reload]);

  const saved = (design: CampaignDesign) => {
    setDesigns((list) => list.map((d) => (d.design_id === design.design_id ? { ...d, ...design } : d)));
    onSaved?.();
  };
  const changed = async () => {
    await reload();
    onSaved?.();
  };

  return (
    <section id="designs" aria-labelledby="designs-title" className="flex scroll-mt-6 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="designs-title" className="font-[family-name:var(--dc-serif)] text-[28px] leading-9 text-[#F40009]">
          Designs
        </h2>
        <p className="max-w-2xl text-sm leading-[22px]">
          The designs users pick from. Add your own, or hide any design from users. Each prints from its own PSD:
          upload it here and the text starts on the can’s name line. If the PSD has a red XXXXXXXX placeholder, find
          it under Edit text settings.
        </p>
      </div>
      {error && (
        <p className="rounded-2xl border border-[#F40009]/30 bg-[#F40009]/5 px-4 py-3 text-sm text-[#B00007]">{error}</p>
      )}
      <AddDesign onAdded={changed} />
      <ul className="grid gap-3 lg:grid-cols-2">
        {designs.map((design) => (
          <DesignRow
            key={design.design_id}
            design={design}
            look={lookOf(design)}
            fonts={fonts}
            onSaved={saved}
            onChanged={changed}
          />
        ))}
      </ul>
    </section>
  );
}

/** Adds a design for users: a name, one of the site's categories, and its sticker image. */
function AddDesign({ onAdded }: { onAdded: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !file) {
      setError("Give the design a name and choose its sticker image.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await adminUpload("/catalog", file, { name: name.trim(), category });
      setName("");
      setFile(null);
      setInputKey((k) => k + 1);
      await onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The design could not be added");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      aria-label="Add a design"
      onSubmit={submit}
      noValidate
      className="flex flex-col gap-3 rounded-2xl border border-dashed border-[#CFCFCF] bg-white p-4"
    >
      <p className="font-semibold text-black">Add a design</p>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <label className="flex flex-col gap-1">
          <span className={CAPTION}>Name</span>
          <input className={FIELD} maxLength={40} placeholder="Summer splash" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={CAPTION}>Category</span>
          <select className={FIELD} value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={CAPTION}>Sticker image</span>
          <input
            key={inputKey}
            type="file"
            accept="image/png,image/webp,image/jpeg"
            className="cursor-pointer text-xs file:mr-2 file:cursor-pointer file:rounded-full file:border file:border-black file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-semibold"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
      </div>
      <p className="text-xs text-[#8A8A8A]">PNG, WebP or JPEG up to 5 MB. A transparent PNG looks best on the can.</p>
      {error && <p className="text-xs text-[#B00007]">{error}</p>}
      <div>
        <button type="submit" disabled={busy} className={SMALL_DARK}>
          {busy ? "Adding…" : "Add design"}
        </button>
      </div>
    </form>
  );
}

function DesignRow({
  design,
  look,
  fonts,
  onSaved,
  onChanged,
}: {
  design: CampaignDesign;
  look: Look;
  fonts: Font[];
  onSaved: (design: CampaignDesign) => void;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const format = design.format;
  const id = design.design_id;

  async function run(action: () => Promise<void>, failure: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : failure);
    } finally {
      setBusy(false);
    }
  }

  // The server keeps a replaced PSD's text settings, and gives a new design the can's name line.
  // No colour search here: Diet Coke art is mostly red, and a search could take the logo for the placeholder.
  const uploadPsd = (file: File) =>
    run(async () => onSaved(await adminUpload<CampaignDesign>(`/designs/${id}/psd`, file)), "Upload failed");
  const setShown = (active: boolean) =>
    run(async () => onSaved(await adminPatch<CampaignDesign>(`/designs/${id}/visibility`, { active })), "Could not change it");
  const replaceSticker = (file: File) =>
    run(async () => {
      await adminUpload(`/catalog/${id}/sticker`, file);
      await onChanged();
    }, "The sticker could not be replaced");
  const remove = () => {
    if (!window.confirm(`Delete ${look.name}? This cannot be undone.`)) return;
    void run(async () => {
      await adminDelete(`/catalog/${id}`);
      await onChanged();
    }, "Could not delete it");
  };

  const fileInput = (inputId: string, label: string, accept: string, onFile: (file: File) => void) => (
    <input
      id={inputId}
      type="file"
      accept={accept}
      aria-label={label}
      className="sr-only"
      disabled={busy}
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (file) onFile(file);
      }}
    />
  );

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
            <Image src={look.sticker} alt="" sizes="64px" className="h-full w-full object-contain" />
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
        {fileInput(`psd-${id}`, `Upload PSD for ${look.name}`, ".psd", (file) => void uploadPsd(file))}
        {format && !editing && (
          <button onClick={() => setEditing(true)} className={SMALL_LINK}>
            Edit text settings
          </button>
        )}
        <button onClick={() => void setShown(!design.active)} disabled={busy} className={SMALL_LINK}>
          {design.active ? "Hide from users" : "Show to users"}
        </button>
        {!design.builtin && (
          <>
            <label htmlFor={`sticker-${id}`} className={`${SMALL_LINK} cursor-pointer ${busy ? "pointer-events-none opacity-50" : ""}`}>
              Replace sticker
            </label>
            {fileInput(`sticker-${id}`, `Replace sticker for ${look.name}`, "image/png,image/webp,image/jpeg", (file) => void replaceSticker(file))}
            <button onClick={remove} disabled={busy} className={`${SMALL_LINK} text-[#B00007]`}>
              Delete
            </button>
          </>
        )}
      </div>
      {error && <p className="text-xs text-[#B00007]">{error}</p>}
      {format && editing && (
        <TextSettings
          designId={id}
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
