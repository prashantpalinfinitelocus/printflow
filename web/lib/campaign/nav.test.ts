import { afterEach, describe, expect, it, vi } from "vitest";

/* setup.ts replaces the module for component tests; here the real one is under test. */
const { useCampaignRouter } = await vi.importActual<typeof import("./nav")>("./nav");

describe("useCampaignRouter", () => {
  const assign = vi.fn();
  const replace = vi.fn();

  afterEach(() => vi.unstubAllGlobals());

  function mountedRouter() {
    vi.stubGlobal("location", { assign, replace });
    return useCampaignRouter();
  }

  it("moves with a full page load, so the URL stays at the domain root", () => {
    mountedRouter().push("/user-campaign/create");

    expect(assign).toHaveBeenCalledWith("/user-campaign/create");
  });

  it("replaces the history entry for guard redirects", () => {
    mountedRouter().replace("/user-campaign?login=1");

    expect(replace).toHaveBeenCalledWith("/user-campaign?login=1");
  });

  it("refuses to leave the campaign for another path", () => {
    const router = mountedRouter();
    assign.mockClear();

    expect(() => router.push("/offline-store/queue")).toThrow();
    expect(() => router.push("//evil.example")).toThrow();
    expect(assign).not.toHaveBeenCalled();
  });
});
