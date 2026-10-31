import { describe, expect, it } from "vitest";

import { metadata } from "./layout";

describe("campaign metadata", () => {
  it("titles the tab with a plain separator", () => {
    expect(metadata.title).toBe("Diet Coke | Make it yours");
  });
});
