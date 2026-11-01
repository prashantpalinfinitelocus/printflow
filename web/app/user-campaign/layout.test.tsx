import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import CampaignLayout, { metadata } from "./layout";

describe("campaign metadata", () => {
  it("titles the tab with a plain separator", () => {
    expect(metadata.title).toBe("Diet Coke - Make it yours");
  });
});

describe("campaign layout", () => {
  it("keeps the 480px phone column below 1024px and goes full width from there for the web designs", () => {
    const { container } = render(<CampaignLayout>page</CampaignLayout>);
    const column = container.querySelector(".max-w-\\[480px\\]");
    expect(column).toHaveClass("lg:max-w-none");
  });
});
