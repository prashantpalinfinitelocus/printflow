import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { campaignApi } from "@/lib/campaign/api";
import { designById, stickerSrc } from "@/lib/campaign/designs";

import { CanPreview } from "./CanPreview";

describe("CanPreview with a design an admin added", () => {
  afterEach(() => vi.restoreAllMocks());

  it("puts the added design's sticker on the can and names it", async () => {
    vi.spyOn(campaignApi, "listDesigns").mockResolvedValue({
      added: [{ designId: "SUMMER_SPLASH", name: "Summer splash", category: "Travel", version: 2 }],
      hidden: [],
    });
    const { container } = render(<CanPreview designId="SUMMER_SPLASH" text="Aanya" />);

    expect(await screen.findByRole("img", { name: /summer splash.*aanya/i })).toBeInTheDocument();
    const srcs = [...container.querySelectorAll("img")].map((i) => i.getAttribute("src"));
    expect(srcs).toContain("/offline-store/api/campaign/designs/SUMMER_SPLASH/sticker?v=2");
  });
});

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
    expect(srcs).toContain(`${stickerSrc(designById("DISCO_BALL"))}?q=90`);
    expect(srcs.some((src) => src?.includes("can-blank") && src.endsWith("?q=90"))).toBe(true);
  });

  it("shows a bare can, without a text claim, before anything is typed", () => {
    const { container } = render(<CanPreview designId="DISCO_BALL" text="" />);
    expect(screen.getByRole("img", { name: /disco ball/i }).getAttribute("aria-label")).not.toMatch(/text/);
    expect(container.textContent).toBe("");
  });
});
