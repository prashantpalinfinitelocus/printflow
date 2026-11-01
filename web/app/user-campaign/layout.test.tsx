import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import CampaignLayout, { metadata } from "./layout";

describe("campaign metadata", () => {
  it("titles the tab with a plain separator", () => {
    expect(metadata.title).toBe("Diet Coke - Make it yours");
  });
});

describe("campaign layout", () => {
  it("fills the whole screen at every width, so tablets get no white bands at the sides", () => {
    const { container } = render(<CampaignLayout>page</CampaignLayout>);
    const column = container.firstElementChild!.firstElementChild!;
    expect(column).toHaveClass("w-full");
    expect(column.className).not.toMatch(/max-w-/);
  });
});
