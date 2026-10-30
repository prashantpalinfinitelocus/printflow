import { describe, expect, it } from "vitest";

import { DEFAULT_DESIGN_ID, DESIGNS, designById } from "./designs";

describe("DESIGNS", () => {
  it("lists the nine Figma stickers in grid order", () => {
    expect(DESIGNS.map((d) => d.id)).toEqual([
      "ARCTIC_FRIENDS",
      "CLINKING_BOTTLES",
      "RED_RIBBON",
      "POLAR_BEARS_HEART",
      "HAPPY_BIRTHDAY",
      "SURFING_POLAR_BEAR",
      "POLAR_BEAR_CHILL",
      "BEACH_VIBES",
      "DISCO_BALL",
    ]);
  });

  it("gives every design its own sticker image", () => {
    const srcs = new Set(DESIGNS.map((d) => d.sticker.src));
    expect(srcs.size).toBe(9);
  });

  it("defaults to the clinking bottles selected in Figma", () => {
    expect(DEFAULT_DESIGN_ID).toBe("CLINKING_BOTTLES");
  });
});

describe("designById", () => {
  it("finds a design by id", () => {
    expect(designById("DISCO_BALL").name).toBe("Disco ball");
  });

  it("falls back to the default design for an unknown or retired id", () => {
    expect(designById("NOT_A_DESIGN").id).toBe(DEFAULT_DESIGN_ID);
  });
});
