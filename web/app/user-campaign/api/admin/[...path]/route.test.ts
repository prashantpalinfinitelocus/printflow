import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET, PATCH, POST } from "./route";

const upstream = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", upstream);
  vi.stubEnv("API_BASE_URL", "http://api.test");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  upstream.mockReset();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function request(path: string, init: { method?: string; body?: unknown; cookie?: string; accept?: string } = {}) {
  return new NextRequest(`https://site.test/user-campaign/api/admin/${path}`, {
    method: init.method ?? "GET",
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    headers: {
      "content-type": "application/json",
      ...(init.cookie ? { cookie: init.cookie } : {}),
      ...(init.accept ? { accept: init.accept } : {}),
    },
  });
}

const ctx = (path: string) => ({ params: Promise.resolve({ path: path.split("/") }) });

describe("campaign admin route", () => {
  it.each(["../auth/me", "days/../../orders", "%2e%2e/print-formats", "days//x"])("refuses the path %s", async (path) => {
    const res = await GET(request(path), ctx(path));
    expect(res.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("signs in, keeping the token in a cookie only this route receives", async () => {
    upstream.mockResolvedValue(json({ token: "tok", expires_in: 3600, admin: { username: "ops" } }));

    const res = await POST(request("auth/login", { method: "POST", body: { username: "ops", password: "pw" } }), ctx("auth/login"));

    expect(upstream).toHaveBeenCalledWith("http://api.test/campaign-admin/auth/login", expect.objectContaining({ method: "POST" }));
    expect(await res.json()).toEqual({ admin: { username: "ops" } });
    const cookie = res.cookies.get("dc_admin");
    expect(cookie?.value).toBe("tok");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.path).toBe("/user-campaign/api/admin");
    expect(cookie?.secure).toBe(true);
    expect(cookie?.maxAge).toBe(3600);
  });

  it("passes a failed sign-in's message through without setting a cookie", async () => {
    upstream.mockResolvedValue(json({ detail: "Wrong user ID or password" }, 401));

    const res = await POST(request("auth/login", { method: "POST", body: { username: "x", password: "y" } }), ctx("auth/login"));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ detail: "Wrong user ID or password" });
    expect(res.cookies.get("dc_admin")).toBeUndefined();
  });

  it("signs out on the API and clears the cookie", async () => {
    upstream.mockResolvedValue(new Response(null, { status: 204 }));

    const res = await POST(request("auth/logout", { method: "POST", cookie: "dc_admin=tok" }), ctx("auth/logout"));

    expect(upstream).toHaveBeenCalledWith(
      "http://api.test/campaign-admin/auth/logout",
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
    expect((upstream.mock.calls[0][1].headers as Headers).get("authorization")).toBe("Bearer tok");
    expect(res.status).toBe(204);
    expect(res.cookies.get("dc_admin")?.value).toBe("");
  });

  it("forwards other calls to the API's /campaign-admin routes with the session as a bearer token", async () => {
    upstream.mockResolvedValue(json({ day: "2026-10-30" }));

    const res = await GET(request("days/2026-10-30", { cookie: "dc_admin=tok" }), ctx("days/2026-10-30"));

    expect(upstream.mock.calls[0][0]).toBe("http://api.test/campaign-admin/days/2026-10-30");
    expect((upstream.mock.calls[0][1].headers as Headers).get("authorization")).toBe("Bearer tok");
    expect(await res.json()).toEqual({ day: "2026-10-30" });
  });

  it("keeps the query string, for the winners sheet", async () => {
    upstream.mockResolvedValue(new Response("a,b", { headers: { "content-type": "text/csv" } }));
    const req = new NextRequest(
      "https://site.test/user-campaign/api/admin/days/2026-10-30/winners.csv?link_base=https%3A%2F%2Fx.test",
      { headers: { cookie: "dc_admin=tok" } },
    );

    await GET(req, ctx("days/2026-10-30/winners.csv"));

    expect(upstream.mock.calls[0][0]).toBe(
      "http://api.test/campaign-admin/days/2026-10-30/winners.csv?link_base=https%3A%2F%2Fx.test",
    );
  });

  it("streams a TIFF back with its download name", async () => {
    upstream.mockResolvedValue(
      new Response(new Uint8Array([73, 73, 42, 0]), {
        headers: { "content-type": "image/tiff", "content-disposition": 'attachment; filename="001.tif"' },
      }),
    );

    const res = await GET(request("winners/1/tiff", { cookie: "dc_admin=tok" }), ctx("winners/1/tiff"));

    expect(res.headers.get("content-type")).toBe("image/tiff");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="001.tif"');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([73, 73, 42, 0]));
  });

  it("sends a signed-out browser that opens a TIFF link to the campaign admin login", async () => {
    const res = await GET(request("winners/1/tiff", { accept: "text/html,*/*" }), ctx("winners/1/tiff"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("/user-campaign/admin/login");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("sends a browser whose session has expired back to the login too, not to a JSON error", async () => {
    upstream.mockResolvedValue(json({ detail: "Your session has expired. Please sign in again." }, 401));

    const res = await GET(request("winners/1/tiff", { cookie: "dc_admin=old", accept: "text/html,*/*" }), ctx("winners/1/tiff"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("/user-campaign/admin/login");
  });

  it("does not import PrintFlow's session module", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("app/user-campaign/api/admin/[...path]/route.ts", "utf8");
    expect(source).not.toMatch(/@\/lib\/session|@\/lib\/client|basePath/);
  });

  it("forwards edits, such as a design's text settings", async () => {
    upstream.mockResolvedValue(json({ design_id: "DISCO_BALL" }));

    await PATCH(request("designs/DISCO_BALL", { method: "PATCH", body: { font_size: 60 }, cookie: "dc_admin=tok" }), ctx("designs/DISCO_BALL"));

    expect(upstream.mock.calls[0][1].method).toBe("PATCH");
  });

  it("never sends PrintFlow's staff cookie to the API", async () => {
    upstream.mockResolvedValue(json({}));

    await GET(request("days/2026-10-30", { cookie: "pf_token=staff" }), ctx("days/2026-10-30"));

    expect((upstream.mock.calls[0][1].headers as Headers).get("authorization")).toBeNull();
  });
});
