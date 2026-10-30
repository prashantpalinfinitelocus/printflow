import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "./route";

vi.mock("@/lib/session", () => ({ API_BASE: "http://api.test" }));

const upstream = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", upstream);
});

afterEach(() => {
  vi.unstubAllGlobals();
  upstream.mockReset();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function request(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  return new NextRequest(`https://site.test/offline-store/api/campaign/${path}`, {
    method: init.method ?? "POST",
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    headers: { "content-type": "application/json", ...(init.cookie ? { cookie: init.cookie } : {}) },
  });
}

const ctx = (path: string) => ({ params: Promise.resolve({ path: path.split("/") }) });

describe("campaign proxy", () => {
  it.each(["../auth/login", "otp/../../auth/login", "./window", "otp//send", "%2e%2e/auth/login"])(
    "refuses the path %s instead of forwarding it",
    async (path) => {
      const res = await POST(request(path, { body: {} }), ctx(path));

      expect(res.status).toBe(404);
      expect(upstream).not.toHaveBeenCalled();
    },
  );

  it("forwards to the API's /campaign routes with the session cookie as a bearer token", async () => {
    upstream.mockResolvedValue(json({ result: "APPROVED" }));
    const res = await POST(request("moderate", { body: { text: "Aanya" }, cookie: "dc_token=abc" }), ctx("moderate"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: "APPROVED" });
    const [url, init] = upstream.mock.calls[0];
    expect(url).toBe("http://api.test/campaign/moderate");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer abc");
    expect(new TextDecoder().decode(init.body)).toBe(JSON.stringify({ text: "Aanya" }));
  });

  it("never forwards the staff session", async () => {
    upstream.mockResolvedValue(json({ state: "OPEN" }));
    await GET(request("window", { method: "GET", cookie: "pf_token=staff" }), ctx("window"));
    expect(new Headers(upstream.mock.calls[0][1].headers).get("authorization")).toBeNull();
  });

  it("keeps the token from verify in an httpOnly cookie, out of page scripts", async () => {
    upstream.mockResolvedValue(json({ token: "jwt-1", expires_in: 86400, phone: "9876543210", email: "a@b.co" }));
    const res = await POST(
      request("otp/verify", { body: { phone: "9876543210", email: "a@b.co", code: "123456" } }),
      ctx("otp/verify"),
    );

    expect(await res.json()).toEqual({ phone: "9876543210", email: "a@b.co" });
    const cookie = res.cookies.get("dc_token");
    expect(cookie).toMatchObject({ value: "jwt-1", httpOnly: true, sameSite: "lax", secure: true, maxAge: 86400 });
    // Only the campaign proxy needs it; nothing else on the domain should receive it.
    expect(cookie?.path).toBe("/offline-store/api/campaign");
  });

  it("passes a failed verify straight through without setting a cookie", async () => {
    const detail = { code: "OTP_WRONG", message: "That code doesn't match. Try again." };
    upstream.mockResolvedValue(json({ detail }, 400));
    const res = await POST(request("otp/verify", { body: { code: "000000" } }), ctx("otp/verify"));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ detail });
    expect(res.cookies.get("dc_token")).toBeUndefined();
  });

  it("answers 503 with a code when the API cannot be reached", async () => {
    upstream.mockRejectedValue(new TypeError("fetch failed"));
    const res = await GET(request("window", { method: "GET" }), ctx("window"));

    expect(res.status).toBe(503);
    expect((await res.json()).detail.code).toBe("UNAVAILABLE");
  });
});
