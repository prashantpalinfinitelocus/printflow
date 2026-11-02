import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminApiError, adminGet, adminUpload, LOGIN_PATH, sheetUrl, tiffUrl, yesterdayInIndia } from "./admin";

const assign = vi.fn();

beforeEach(() => vi.stubGlobal("location", { ...window.location, assign }));
afterEach(() => {
  vi.unstubAllGlobals();
  assign.mockReset();
});

describe("campaign admin API client", () => {
  it("calls the campaign admin's own API route, never PrintFlow's", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await adminGet("/days/2026-10-30")).toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledWith("/user-campaign/api/admin/days/2026-10-30", expect.anything());
  });

  it("sends a signed-out admin to the campaign admin login", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "Not signed in" }), { status: 401 })));

    await expect(adminGet("/days/2026-10-30")).rejects.toEqual(new AdminApiError("Not signed in", 401));
    expect(assign).toHaveBeenCalledWith(LOGIN_PATH);
    expect(LOGIN_PATH).toBe("/user-campaign/admin/login");
  });

  it("explains a refused value in words, not a status code", async () => {
    const detail = [{ loc: ["body", "font_size"], msg: "Input should be greater than or equal to 1" }];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail }), { status: 422 })));

    await expect(adminGet("/designs")).rejects.toEqual(
      new AdminApiError("font_size: Input should be greater than or equal to 1", 422),
    );
  });

  it("uploads a file as a form", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await adminUpload("/designs/DISCO_BALL/psd", new File(["x"], "a.psd"));
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect((init.body as FormData).get("file")).toBeInstanceOf(File);
  });

  it("builds TIFF and sheet links through the campaign admin's route", () => {
    expect(tiffUrl(4)).toBe("/user-campaign/api/admin/winners/4/tiff");
    const sheet = new URL(sheetUrl("2026-10-30"), "http://x.test");
    expect(sheet.pathname).toBe("/user-campaign/api/admin/days/2026-10-30/winners.csv");
    expect(sheet.searchParams.get("link_base")).toBe(`${window.location.origin}/user-campaign/api/admin`);
  });
});

describe("yesterdayInIndia", () => {
  it("is the day before today in India time, as YYYY-MM-DD", () => {
    expect(yesterdayInIndia(new Date("2026-10-31T12:00:00Z"))).toBe("2026-10-30");
  });

  it("has already moved on after midnight India time, while UTC is still on the old day", () => {
    // 00:30 IST on 1 Nov is 19:00 UTC on 31 Oct.
    expect(yesterdayInIndia(new Date("2026-10-31T19:00:00Z"))).toBe("2026-10-31");
  });

  it("crosses month ends", () => {
    expect(yesterdayInIndia(new Date("2026-11-01T06:00:00Z"))).toBe("2026-10-31");
  });
});
