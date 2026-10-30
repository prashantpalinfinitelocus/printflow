import { describe, expect, it } from "vitest";

import { canLayers, containRect, paintCan } from "./canImage";

describe("canLayers", () => {
  // Pixel boxes read off the layered Figma can, frame 211:1407 (621×1536).
  const layers = canLayers(621, 1536);

  it("places the sticker where Figma does", () => {
    expect(layers.sticker.x).toBeCloseTo(146, 0);
    expect(layers.sticker.y).toBeCloseTo(768, 0);
    expect(layers.sticker.w).toBeCloseTo(329, 0);
    expect(layers.sticker.h).toBeCloseTo(294, 0);
  });

  it("sets the name at Figma's 36px, centred, 721px down", () => {
    expect(layers.name.fontSize).toBeCloseTo(36, 0);
    expect(layers.name.x).toBe(310.5);
    expect(layers.name.y).toBeCloseTo(721, 0);
  });

  it("scales with the can, so a double-size export keeps the proportions", () => {
    const big = canLayers(1242, 3072);
    expect(big.name.fontSize).toBeCloseTo(72, 0);
    expect(big.sticker.w).toBeCloseTo(658, 0);
  });
});

describe("containRect", () => {
  it("letterboxes a wide image vertically inside a square box", () => {
    expect(containRect(200, 100, { x: 0, y: 0, w: 100, h: 100 })).toEqual({ x: 0, y: 25, w: 100, h: 50 });
  });

  it("pillarboxes a tall image horizontally, keeping the box offset", () => {
    expect(containRect(100, 200, { x: 10, y: 20, w: 100, h: 100 })).toEqual({ x: 35, y: 20, w: 50, h: 100 });
  });
});

/** Records what paintCan draws; jsdom has no real canvas. */
function recorder() {
  const calls: unknown[][] = [];
  const ctx = {
    font: "",
    fillStyle: "",
    textAlign: "",
    textBaseline: "",
    letterSpacing: "",
    drawImage: (...args: unknown[]) => calls.push(["drawImage", ...args]),
    fillText: (...args: unknown[]) => calls.push(["fillText", ...args]),
  };
  return { ctx, calls };
}

describe("paintCan", () => {
  const can = { naturalWidth: 621, naturalHeight: 1536 };
  const sticker = { naturalWidth: 100, naturalHeight: 100 };

  it("draws the can, then the sticker contained in its box, then the name on top", () => {
    const { ctx, calls } = recorder();
    paintCan(ctx as never, { can: can as never, sticker: sticker as never }, "Aanya", "You2013");
    expect(calls.map((c) => c[0])).toEqual(["drawImage", "drawImage", "fillText"]);
    expect(calls[0]).toEqual(["drawImage", can, 0, 0, 621, 1536]);
    const [, , sx, sy, sw, sh] = calls[1] as number[];
    expect(sw).toBeCloseTo(sh, 5); // square sticker stays square
    expect(sx + sw / 2).toBeCloseTo(310.5, 0); // centred in the can
    expect(sy).toBeGreaterThanOrEqual(768);
  });

  it("prints the name in capitals in the can red, in the can font", () => {
    const { ctx, calls } = recorder();
    paintCan(ctx as never, { can: can as never, sticker: sticker as never }, "Aanya", "You2013");
    expect(calls[2]).toEqual(["fillText", "AANYA", 310.5, expect.closeTo(721, 0)]);
    expect(ctx.fillStyle).toBe("#F40009");
    expect(ctx.font).toMatch(/You2013/);
    expect(ctx.textAlign).toBe("center");
  });
});
