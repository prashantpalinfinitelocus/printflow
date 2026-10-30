import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CampaignError, CampaignServerError, createHttpCampaignApi, errorMessage } from "./api";

const fetchMock = vi.fn();
const api = createHttpCampaignApi();

beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

const reply = (body: unknown, status = 200) =>
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
const fail = (status: number, code: string, message = "msg") => reply({ detail: { code, message } }, status);

/** The URL and parsed JSON body of the nth fetch. */
const sent = (n = 0) => {
  const [url, init] = fetchMock.mock.calls[n];
  return { url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : undefined };
};

describe("http campaign api", () => {
  it("sends the OTP request through the campaign proxy", async () => {
    reply({ resend_after: 30 });
    expect(await api.sendOtp("9876543210", "a@b.co")).toEqual({ resendAfter: 30 });
    expect(sent()).toEqual({
      url: "/offline-store/api/campaign/otp/send",
      method: "POST",
      body: { phone: "9876543210", email: "a@b.co" },
    });
  });

  it("returns the session the proxy hands back after verify", async () => {
    reply({ phone: "9876543210", email: "a@b.co" });
    expect(await api.verifyOtp("9876543210", "a@b.co", "123456")).toEqual({ phone: "9876543210", email: "a@b.co" });
    expect(sent().body).toEqual({ phone: "9876543210", email: "a@b.co", code: "123456" });
  });

  it("turns a wrong code into OTP_WRONG with the server's message", async () => {
    fail(400, "OTP_WRONG", "That code doesn't match. Try again.");
    const error = await api.verifyOtp("9876543210", "a@b.co", "000000").catch((e) => e);
    expect(error).toBeInstanceOf(CampaignError);
    expect(error).toMatchObject({ code: "OTP_WRONG", message: "That code doesn't match. Try again." });
  });

  it.each(["OTP_BLOCKED", "OTP_LOCKED"] as const)("keeps %s and how long to wait", async (code) => {
    reply({ detail: { code, message: "Too many tries.", retry_after: 7200 } }, 429);
    const error = await api.sendOtp("9876543210", "a@b.co").catch((e) => e);
    expect(error).toBeInstanceOf(CampaignError);
    expect(error).toMatchObject({ code, message: "Too many tries.", retryAfter: 7200 });
  });

  it.each(["OTP_SEND_FAILED", "ENTRY_LIMIT_REACHED"] as const)("recognises %s", async (code) => {
    fail(code === "OTP_SEND_FAILED" ? 503 : 409, code, "Try later.");
    const error = await api.sendOtp("9876543210", "a@b.co").catch((e) => e);
    expect(error).toBeInstanceOf(CampaignError);
    expect(error.code).toBe(code);
  });

  it("reports the text check's verdict", async () => {
    reply({ result: "REJECTED" });
    expect(await api.moderateText("stupid")).toBe("REJECTED");
    expect(sent()).toMatchObject({ url: "/offline-store/api/campaign/moderate", body: { text: "stupid" } });
  });

  it("treats an unavailable checker as a plain failure, never as approval", async () => {
    fail(503, "MODERATION_UNAVAILABLE");
    const error = await api.moderateText("Aanya").catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(CampaignError);
  });

  it("surfaces an expired session as UNAUTHORIZED", async () => {
    fail(401, "UNAUTHORIZED");
    await expect(api.moderateText("Aanya")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it.each(["TEXT_REJECTED", "TEXT_INVALID"])("surfaces a server-side %s so the user can edit", async (code) => {
    fail(422, code, "That line isn’t quite the Diet Coke vibe.");
    await expect(
      api.submitEntry({ designId: "DISCO_BALL", text: "Aanya", idempotencyKey: "k" }),
    ).rejects.toMatchObject({ code, message: "That line isn’t quite the Diet Coke vibe." });
  });

  it("reads the entry window", async () => {
    reply({ state: "BEFORE_OPEN" });
    expect(await api.getWindowState()).toBe("BEFORE_OPEN");
    expect(sent()).toMatchObject({ url: "/offline-store/api/campaign/window", method: "GET" });
  });

  it("submits an entry in the API's shape and returns its id", async () => {
    reply({ entry_id: "e-1" }, 201);
    const entry = { designId: "DISCO_BALL", text: "Aanya", idempotencyKey: "k-1" };
    expect(await api.submitEntry(entry)).toEqual({ entryId: "e-1" });
    expect(sent().body).toEqual({ design_id: "DISCO_BALL", text: "Aanya", idempotency_key: "k-1" });
  });

  it("explains a closed window with the server's message", async () => {
    fail(409, "WINDOW_CLOSED", "Today’s entry window is closed. Come back at 10 AM IST tomorrow.");
    await expect(
      api.submitEntry({ designId: "DISCO_BALL", text: "Aanya", idempotencyKey: "k" }),
    ).rejects.toMatchObject({ code: "WINDOW_CLOSED", message: "Today’s entry window is closed. Come back at 10 AM IST tomorrow." });
  });

  it("fails plainly when the network does", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    await expect(api.getWindowState()).rejects.toThrow();
  });

  it("keeps the server's message on a failure it has no code for", async () => {
    fail(503, "UNAVAILABLE", "We can’t reach the campaign right now. Please try again.");
    const error = await api.sendOtp("9876543210", "a@b.co").catch((e) => e);
    expect(error).toBeInstanceOf(CampaignServerError);
    expect(errorMessage(error, "fallback")).toBe("We can’t reach the campaign right now. Please try again.");
  });

  it("falls back to the screen's copy when there is no server message to show", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const error = await api.getWindowState().catch((e) => e);
    expect(errorMessage(error, "fallback")).toBe("fallback");
  });
});
