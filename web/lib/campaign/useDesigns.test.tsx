import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { campaignApi } from "./api";
import { DEFAULT_DESIGN_ID, DESIGNS } from "./designs";
import { loadDesigns, useDesigns } from "./useDesigns";

const SUMMER = { designId: "SUMMER_SPLASH", name: "Summer splash", category: "Travel" as const, version: 3 };
const changes = (added = [SUMMER], hidden: string[] = []) => ({ added, hidden });

afterEach(() => vi.restoreAllMocks());

describe("useDesigns", () => {
  it("lists the built-in designs, then the ones an admin added", async () => {
    vi.spyOn(campaignApi, "listDesigns").mockResolvedValue(changes());
    const { result } = renderHook(useDesigns);

    await waitFor(() => expect(result.current.designs).toHaveLength(DESIGNS.length + 1));
    const summer = result.current.designs.at(-1)!;
    expect(summer).toMatchObject({ id: "SUMMER_SPLASH", name: "Summer splash", category: "Travel" });
    // Through the campaign's own route, with the version so a replaced sticker is fetched afresh.
    expect(summer.sticker).toBe("/offline-store/api/campaign/designs/SUMMER_SPLASH/sticker?v=3");
    expect(summer.thumb).toBeUndefined();
    expect(result.current.find("SUMMER_SPLASH").name).toBe("Summer splash");
  });

  it("leaves out built-in designs an admin hid", async () => {
    vi.spyOn(campaignApi, "listDesigns").mockResolvedValue(changes([], ["DISCO_BALL", "RED_RIBBON"]));
    const { result } = renderHook(useDesigns);

    await waitFor(() => expect(result.current.designs).toHaveLength(DESIGNS.length - 2));
    expect(result.current.designs.map((d) => d.id)).not.toContain("DISCO_BALL");
    expect(result.current.find("DISCO_BALL").id).toBe(DEFAULT_DESIGN_ID);
  });

  it("falls back to the first design still shown when the default one is hidden", async () => {
    vi.spyOn(campaignApi, "listDesigns").mockResolvedValue(changes([], [DEFAULT_DESIGN_ID]));
    const { result } = renderHook(useDesigns);

    await waitFor(() => expect(result.current.designs).toHaveLength(DESIGNS.length - 1));
    expect(result.current.find("RETIRED").id).toBe(result.current.designs[0].id);
  });

  it("falls back to the default design for an id it does not know", () => {
    vi.spyOn(campaignApi, "listDesigns").mockResolvedValue(changes([]));
    const { result } = renderHook(useDesigns);
    expect(result.current.find("RETIRED").id).toBe(DEFAULT_DESIGN_ID);
  });

  it("asks the API once, however many components want the designs", async () => {
    const list = vi.spyOn(campaignApi, "listDesigns").mockResolvedValue(changes());
    await Promise.all([loadDesigns(), loadDesigns()]);
    renderHook(useDesigns);
    expect(list).toHaveBeenCalledOnce();
  });

  it("still shows the built-in designs when the list cannot be loaded, and tries again later", async () => {
    const list = vi.spyOn(campaignApi, "listDesigns").mockRejectedValueOnce(new Error("offline")).mockResolvedValue(changes());
    expect(await loadDesigns()).toEqual(DESIGNS);
    expect((await loadDesigns()).at(-1)!.id).toBe("SUMMER_SPLASH");
    expect(list).toHaveBeenCalledTimes(2);
  });
});
