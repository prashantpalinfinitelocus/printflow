import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CampaignError, MOCK_OTP, WINDOW_MESSAGE, createMockCampaignApi, type CampaignApi } from "./api";

/** Runs a mock call to completion, letting its simulated latency elapse. */
async function settle<T>(promise: Promise<T>): Promise<T> {
  const settled = promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  await vi.advanceTimersByTimeAsync(5_000);
  const result = await settled;
  if (!result.ok) throw result.error;
  return result.value;
}

/** IST is UTC+05:30. */
const ist = (hh: number, mm: number) => new Date(Date.UTC(2026, 9, 30, hh - 5, mm - 30));

let api: CampaignApi;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(ist(12, 0));
  api = createMockCampaignApi();
});

afterEach(() => vi.useRealTimers());

describe("OTP", () => {
  it("tells the client how long to wait before a resend", async () => {
    expect(await settle(api.sendOtp("9876543210", "a@b.co"))).toEqual({ resendAfter: 30 });
  });

  it("returns a session carrying the phone and trimmed email for the right code", async () => {
    await settle(api.sendOtp("9876543210", " a@b.co "));
    const session = await settle(api.verifyOtp("9876543210", " a@b.co ", MOCK_OTP));
    expect(session).toMatchObject({ phone: "9876543210", email: "a@b.co" });
    expect(session.token).toBeTruthy();
  });

  it("rejects a wrong code as OTP_WRONG", async () => {
    await settle(api.sendOtp("9876543210", "a@b.co"));
    await expect(settle(api.verifyOtp("9876543210", "a@b.co", "000000"))).rejects.toMatchObject({
      code: "OTP_WRONG",
    });
  });

  it("treats a code older than five minutes as expired", async () => {
    await settle(api.sendOtp("9876543210", "a@b.co"));
    vi.advanceTimersByTime(5 * 60_000 + 1);
    await expect(settle(api.verifyOtp("9876543210", "a@b.co", MOCK_OTP))).rejects.toMatchObject({
      code: "OTP_EXPIRED",
    });
  });

  it("treats verifying without a sent code as expired", async () => {
    const failure = settle(api.verifyOtp("9876543210", "a@b.co", MOCK_OTP));
    await expect(failure).rejects.toBeInstanceOf(CampaignError);
    await expect(failure).rejects.toMatchObject({ code: "OTP_EXPIRED" });
  });

  it("does not let a used code log in twice", async () => {
    await settle(api.sendOtp("9876543210", "a@b.co"));
    await settle(api.verifyOtp("9876543210", "a@b.co", MOCK_OTP));
    await expect(settle(api.verifyOtp("9876543210", "a@b.co", MOCK_OTP))).rejects.toMatchObject({
      code: "OTP_EXPIRED",
    });
  });
});

describe("moderateText", () => {
  it("approves friendly text", async () => {
    expect(await settle(api.moderateText("t", "Aanya"))).toBe("APPROVED");
  });

  it("rejects blocked words regardless of case", async () => {
    expect(await settle(api.moderateText("t", "You STUPID"))).toBe("REJECTED");
  });

  it("rejects competitor brands", async () => {
    expect(await settle(api.moderateText("t", "pepsi fan"))).toBe("REJECTED");
  });
});

describe("getWindowState (IST)", () => {
  it.each([
    [9, 59, "BEFORE_OPEN"],
    [10, 0, "OPEN"],
    [21, 59, "OPEN"],
    [22, 0, "CLOSED"],
  ] as const)("%i:%i IST is %s", async (hh, mm, state) => {
    vi.setSystemTime(ist(hh, mm));
    expect(await api.getWindowState()).toBe(state);
  });
});

describe("submitEntry", () => {
  const entry = { designId: "DISCO_BALL", text: "Aanya", idempotencyKey: "k1" };

  it("accepts an entry while the window is open", async () => {
    expect((await settle(api.submitEntry("t", entry))).entryId).toBeTruthy();
  });

  it("returns the same entry for a retried idempotency key", async () => {
    const first = await settle(api.submitEntry("t", entry));
    const retry = await settle(api.submitEntry("t", entry));
    expect(retry.entryId).toBe(first.entryId);
  });

  it("creates a separate entry for a new key — entries are unlimited", async () => {
    const first = await settle(api.submitEntry("t", entry));
    const second = await settle(api.submitEntry("t", { ...entry, idempotencyKey: "k2" }));
    expect(second.entryId).not.toBe(first.entryId);
  });

  it("refuses an entry after 10 PM IST with the PRD message", async () => {
    vi.setSystemTime(ist(22, 5));
    await expect(settle(api.submitEntry("t", entry))).rejects.toMatchObject({
      code: "WINDOW_CLOSED",
      message: WINDOW_MESSAGE.CLOSED,
    });
  });
});
