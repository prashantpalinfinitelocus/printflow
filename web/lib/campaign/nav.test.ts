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

  it("replaces the history entry for guard redirects, back to the landing at the domain root", () => {
    mountedRouter().replace("/?login=1");

    expect(replace).toHaveBeenCalledWith("/?login=1");
  });

  it("can go to the landing at the domain root", () => {
    mountedRouter().push("/");

    expect(assign).toHaveBeenCalledWith("/");
  });

  it("still accepts the old landing address, which the server sends on to the root", () => {
    mountedRouter().replace("/user-campaign?login=1");

    expect(replace).toHaveBeenCalledWith("/user-campaign?login=1");
  });

  it("refuses to leave the campaign for another path", () => {
    const router = mountedRouter();
    assign.mockClear();

    expect(() => router.push("/offline-store/queue")).toThrow();
    expect(() => router.push("//evil.example")).toThrow();
    expect(() => router.push("/offline-store")).toThrow();
    expect(() => router.push("/user-campaigns")).toThrow();
    expect(() => router.push("/login")).toThrow();
    expect(assign).not.toHaveBeenCalled();
  });

  it("allows a query on the landing, since it stays on this site", () => {
    expect(() => mountedRouter().push("/?next=//evil.example")).not.toThrow();
    expect(assign).toHaveBeenCalledWith("/?next=//evil.example");
  });
});
