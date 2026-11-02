import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { campaignApi } from "./api";
import { DEFAULT_DESIGN_ID } from "./designs";
import { CampaignProvider, useCampaign } from "./store";
afterEach(() => vi.restoreAllMocks());

const KEY = "dc-campaign";
const wrapper = ({ children }: { children: ReactNode }) => <CampaignProvider>{children}</CampaignProvider>;

describe("CampaignProvider", () => {
  it("starts logged out on the default design once storage has been read", async () => {
    const { result } = renderHook(useCampaign, { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current).toMatchObject({
      session: null,
      designId: DEFAULT_DESIGN_ID,
      text: "",
      approvedText: null,
      headsUpSeen: false,
    });
  });

  it("merges updates into the state", async () => {
    const { result } = renderHook(useCampaign, { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.update({ text: "Aanya" }));
    act(() => result.current.update({ designId: "DISCO_BALL" }));
    expect(result.current).toMatchObject({ text: "Aanya", designId: "DISCO_BALL" });
  });

  it("saves the journey to sessionStorage so a reload keeps it", async () => {
    const { result } = renderHook(useCampaign, { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.update({ text: "Aanya" }));
    await waitFor(() => expect(JSON.parse(sessionStorage.getItem(KEY)!)).toMatchObject({ text: "Aanya" }));
  });

  it("restores a saved journey on mount", async () => {
    sessionStorage.setItem(KEY, JSON.stringify({ text: "Riya", designId: "DISCO_BALL" }));
    const { result } = renderHook(useCampaign, { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current).toMatchObject({ text: "Riya", designId: "DISCO_BALL", headsUpSeen: false });
  });

  it("replaces a retired design id, so what is submitted matches what is shown", async () => {
    sessionStorage.setItem(KEY, JSON.stringify({ designId: "RETIRED_DESIGN" }));
    const { result } = renderHook(useCampaign, { wrapper });
    await waitFor(() => expect(result.current.designId).toBe(DEFAULT_DESIGN_ID));
  });

  it("keeps a design an admin added across a reload", async () => {
    vi.spyOn(campaignApi, "listDesigns").mockResolvedValue({
      added: [{ designId: "SUMMER_SPLASH", name: "Summer splash", category: "Travel", version: 1 }],
      hidden: [],
    });
    sessionStorage.setItem(KEY, JSON.stringify({ designId: "SUMMER_SPLASH" }));
    const { result } = renderHook(useCampaign, { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current.designId).toBe("SUMMER_SPLASH");
  });

  it("starts fresh when the saved journey is corrupt", async () => {
    sessionStorage.setItem(KEY, "{not json");
    const { result } = renderHook(useCampaign, { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.text).toBe("");
  });

  it("does not overwrite saved state with defaults before it has been read", async () => {
    sessionStorage.setItem(KEY, JSON.stringify({ text: "Riya" }));
    const { result } = renderHook(useCampaign, { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(JSON.parse(sessionStorage.getItem(KEY)!).text).toBe("Riya");
  });
});

describe("useCampaign", () => {
  it("fails loudly outside the provider", () => {
    expect(() => renderHook(useCampaign)).toThrow(/CampaignProvider/);
  });
});
