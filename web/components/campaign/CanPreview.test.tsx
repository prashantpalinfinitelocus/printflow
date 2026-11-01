import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { designById } from "@/lib/campaign/designs";

import { CanPreview } from "./CanPreview";

describe("CanPreview", () => {
  it("describes the personalised can for screen readers", () => {
    render(<CanPreview designId="DISCO_BALL" text="Aanya" />);
    expect(screen.getByRole("img", { name: /disco ball.*aanya/i })).toBeInTheDocument();
  });

  it("prints the name in capitals, as it will be printed", () => {
    const { container } = render(<CanPreview designId="DISCO_BALL" text="Aanya" />);
    expect(container).toHaveTextContent("AANYA");
  });

  it("layers the chosen design's sticker on the can, both at quality 90", () => {
    const { container } = render(<CanPreview designId="DISCO_BALL" text="Aanya" />);
    const srcs = [...container.querySelectorAll("img")].map((img) => img.getAttribute("src"));
    expect(srcs).toContain(`${designById("DISCO_BALL").sticker.src}?q=90`);
    expect(srcs.some((src) => src?.includes("can-blank") && src.endsWith("?q=90"))).toBe(true);
  });

  it("shows a bare can, without a text claim, before anything is typed", () => {
    const { container } = render(<CanPreview designId="DISCO_BALL" text="" />);
    expect(screen.getByRole("img", { name: /disco ball/i }).getAttribute("aria-label")).not.toMatch(/text/);
    expect(container.textContent).toBe("");
  });
});
