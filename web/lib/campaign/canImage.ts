import canBlank from "@/app/user-campaign/_assets/can-blank.png";
import { designById, stickerSrc } from "@/lib/campaign/designs";
import { loadDesigns } from "@/lib/campaign/useDesigns";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Layer geometry from the layered Figma can (frame 211:1407, 621×1536), as
 * fractions of the can's width/height. Shared by the on-screen preview and the
 * downloaded PNG so the two always match (PRD 7).
 */
export const CAN_LAYOUT = {
  /** Top of the name line; the line is centred horizontally. Size is a fraction of the width. */
  name: { y: 0.4694, size: 0.058, tracking: 0.06, color: "#F40009" },
  sticker: { x: 0.2351, y: 0.5, w: 0.5298, h: 0.1914 },
};

/** CAN_LAYOUT in pixels for a can drawn at width × height. */
export function canLayers(width: number, height: number) {
  const { name, sticker } = CAN_LAYOUT;
  return {
    sticker: { x: sticker.x * width, y: sticker.y * height, w: sticker.w * width, h: sticker.h * height },
    name: { x: width / 2, y: name.y * height, fontSize: name.size * width },
  };
}

/** Fits an image inside a box, centred, like object-fit: contain. */
export function containRect(imgW: number, imgH: number, box: Rect): Rect {
  const scale = Math.min(box.w / imgW, box.h / imgH);
  const w = imgW * scale;
  const h = imgH * scale;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

/** Draws the can, its sticker and the name at the can image's own resolution. */
export function paintCan(
  ctx: CanvasRenderingContext2D,
  images: { can: HTMLImageElement; sticker: HTMLImageElement },
  text: string,
  fontFamily: string,
) {
  const { can, sticker } = images;
  const W = can.naturalWidth;
  const H = can.naturalHeight;
  const layers = canLayers(W, H);

  ctx.drawImage(can, 0, 0, W, H);
  const s = containRect(sticker.naturalWidth, sticker.naturalHeight, layers.sticker);
  ctx.drawImage(sticker, s.x, s.y, s.w, s.h);

  ctx.font = `${layers.name.fontSize}px ${fontFamily}`;
  ctx.fillStyle = CAN_LAYOUT.name.color;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.letterSpacing = `${CAN_LAYOUT.name.tracking * layers.name.fontSize}px`;
  ctx.fillText(text.toUpperCase(), layers.name.x, layers.name.y);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

/**
 * Renders the personalised can to a transparent PNG. It carries only the
 * artwork and the approved text — no phone, email or IDs (PRD 7).
 */
export async function renderCanPng(designId: string, text: string, fontFamily: string): Promise<Blob> {
  // An added design's sticker is known only once the designs have loaded.
  const design = designById(designId, await loadDesigns());
  const [can, sticker] = await Promise.all([loadImage(canBlank.src), loadImage(stickerSrc(design))]);
  const canvas = document.createElement("canvas");
  canvas.width = can.naturalWidth;
  canvas.height = can.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");

  // The canvas only uses a web font that has already loaded.
  await document.fonts.load(`${canLayers(canvas.width, canvas.height).name.fontSize}px ${fontFamily}`, text);
  paintCan(ctx, { can, sticker }, text, fontFamily);

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not create the image"))), "image/png"),
  );
}
