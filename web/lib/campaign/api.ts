/**
 * Consumer campaign API. The backend endpoints do not exist yet, so the UI
 * talks to `campaignApi`, which is the mock below. When the real API lands,
 * write a fetch-backed `CampaignApi` and export that instead — the screens
 * only depend on this interface.
 */

export type CampaignErrorCode = "OTP_WRONG" | "OTP_EXPIRED" | "WINDOW_CLOSED";

export class CampaignError extends Error {
  constructor(
    readonly code: CampaignErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CampaignError";
  }
}

export type WindowState = "OPEN" | "BEFORE_OPEN" | "CLOSED" | "PAUSED";

export interface Session {
  token: string;
  phone: string;
  email: string;
}

export type ModerationResult = "APPROVED" | "REJECTED";

export interface CampaignApi {
  /** Sends an OTP; resolves to the seconds until a resend is allowed. */
  sendOtp(phone: string, email: string): Promise<{ resendAfter: number }>;
  verifyOtp(phone: string, email: string, code: string): Promise<Session>;
  moderateText(token: string, text: string): Promise<ModerationResult>;
  getWindowState(): Promise<WindowState>;
  /** `idempotencyKey` makes a retried or double-tapped submit create one entry. */
  submitEntry(
    token: string,
    entry: { designId: string; text: string; idempotencyKey: string },
  ): Promise<{ entryId: string }>;
}

/** PRD §5 copy for each entry-window state. */
export const WINDOW_MESSAGE: Record<WindowState, string> = {
  OPEN: "The style desk is open. Entries are accepted from 10 AM to 10 PM IST.",
  BEFORE_OPEN: "The next entry window opens at 10 AM IST. Get your can look ready.",
  CLOSED: "Today’s entry window is closed. Come back at 10 AM IST tomorrow.",
  PAUSED: "Entries are currently unavailable. Please check the campaign terms for updates.",
};

/* ---------------- mock ---------------- */

/** The mock accepts this code for any number. */
export const MOCK_OTP = "123456";
const OTP_TTL_MS = 5 * 60_000;
const RESEND_AFTER_S = 30;
const BLOCKED = ["damn", "hell", "idiot", "stupid", "pepsi", "thums up", "sprite zero"];

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The window is decided by server time; the mock uses the browser clock in IST. */
function istHour(now: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(now),
  );
}

/** A self-contained fake backend; each call gets its own OTP and entry state. */
export function createMockCampaignApi(): CampaignApi {
  const otpSentAt = new Map<string, number>();
  const entries = new Map<string, string>();

  async function getWindowState(): Promise<WindowState> {
    const hour = istHour(new Date());
    if (hour < 10) return "BEFORE_OPEN";
    if (hour >= 22) return "CLOSED";
    return "OPEN";
  }

  return {
    async sendOtp(phone) {
      await delay(500);
      otpSentAt.set(phone, Date.now());
      return { resendAfter: RESEND_AFTER_S };
    },

    async verifyOtp(phone, email, code) {
      await delay(500);
      const sentAt = otpSentAt.get(phone);
      if (sentAt === undefined || Date.now() - sentAt > OTP_TTL_MS) {
        throw new CampaignError("OTP_EXPIRED", "That code has expired. Tap resend for a new one.");
      }
      if (code !== MOCK_OTP) throw new CampaignError("OTP_WRONG", "That code doesn't match. Try again.");
      otpSentAt.delete(phone);
      return { token: `mock-${crypto.randomUUID()}`, phone, email: email.trim() };
    },

    async moderateText(_token, text) {
      await delay(700);
      const lower = text.toLowerCase();
      return BLOCKED.some((word) => lower.includes(word)) ? "REJECTED" : "APPROVED";
    },

    getWindowState,

    async submitEntry(_token, { idempotencyKey }) {
      await delay(700);
      const state = await getWindowState();
      if (state !== "OPEN") throw new CampaignError("WINDOW_CLOSED", WINDOW_MESSAGE[state]);
      const existing = entries.get(idempotencyKey);
      if (existing) return { entryId: existing };
      const entryId = `ENT-${crypto.randomUUID()}`;
      entries.set(idempotencyKey, entryId);
      return { entryId };
    },
  };
}

export const campaignApi: CampaignApi = createMockCampaignApi();
