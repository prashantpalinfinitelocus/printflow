/**
 * Consumer campaign API. The screens only depend on `CampaignApi`; `campaignApi`
 * is the real backend (api/app/routers/campaign.py) through the campaign proxy.
 * NEXT_PUBLIC_CAMPAIGN_API=mock swaps in the in-browser mock for tests and local
 * UI work only: it is inlined at build time, so deployed images always use the API.
 */

import { withBasePath } from "@/lib/basePath";
import type { Category } from "@/lib/campaign/designs";

/**
 * UNAUTHORIZED: the session expired or was revoked — log in again.
 * TEXT_REJECTED / TEXT_INVALID: the server refused the text at submit (moderation is
 * not deterministic, so a text approved earlier can still be refused) — edit it.
 * OTP_BLOCKED / OTP_LOCKED: too many codes asked for or wrong codes typed; `retryAfter` is the wait in seconds.
 */
export type CampaignErrorCode =
  | "OTP_WRONG"
  | "OTP_EXPIRED"
  | "WINDOW_CLOSED"
  | "UNAUTHORIZED"
  | "TEXT_REJECTED"
  | "TEXT_INVALID"
  | "OTP_BLOCKED"
  | "OTP_LOCKED"
  | "OTP_SEND_FAILED"
  | "ENTRY_LIMIT_REACHED";

/** A failure the server explained in words meant for the user, but with no code the screens act on. */
export class CampaignServerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CampaignServerError";
  }
}

/**
 * What to tell the user about `err`: the server's own message when it sent one,
 * otherwise the screen's copy — never a raw network or parse error.
 */
export const errorMessage = (err: unknown, fallback: string) =>
  err instanceof CampaignError || err instanceof CampaignServerError ? err.message : fallback;

export const isUnauthorized = (err: unknown) => err instanceof CampaignError && err.code === "UNAUTHORIZED";

export class CampaignError extends Error {
  constructor(
    readonly code: CampaignErrorCode,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "CampaignError";
  }
}

export type WindowState = "OPEN" | "BEFORE_OPEN" | "CLOSED" | "PAUSED";

/** Who is logged in. The token itself stays in an httpOnly cookie set by the campaign proxy. */
export interface Session {
  phone: string;
  email: string;
}

export type ModerationResult = "APPROVED" | "REJECTED";

/** A design a campaign admin added; its sticker is served at designs/<id>/sticker. */
export interface AddedDesign {
  designId: string;
  name: string;
  category: Category;
  /** Bumped when the sticker is replaced, so the sticker's URL changes with it. */
  version: number;
}

export interface DesignChanges {
  added: AddedDesign[];
  /** Ids of built-in designs taken away from users. */
  hidden: string[];
}

export interface CampaignApi {
  /** Sends an OTP; resolves to the seconds until a resend is allowed. */
  sendOtp(phone: string, email: string): Promise<{ resendAfter: number }>;
  verifyOtp(phone: string, email: string, code: string): Promise<Session>;
  moderateText(text: string): Promise<ModerationResult>;
  getWindowState(): Promise<WindowState>;
  /** How an admin changed the nine built-in designs: designs added and shown, and built-in ones hidden. */
  listDesigns(): Promise<DesignChanges>;
  /** `idempotencyKey` makes a retried or double-tapped submit create one entry. */
  submitEntry(entry: { designId: string; text: string; idempotencyKey: string }): Promise<{ entryId: string }>;
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
      return { phone, email: email.trim() };
    },

    async moderateText(text) {
      await delay(700);
      const lower = text.toLowerCase();
      return BLOCKED.some((word) => lower.includes(word)) ? "REJECTED" : "APPROVED";
    },

    getWindowState,

    // The mock campaign has only the built-in designs.
    async listDesigns() {
      return { added: [], hidden: [] };
    },

    async submitEntry({ idempotencyKey }) {
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

/* ---------------- backend ---------------- */

/** Error codes the screens branch on; any other failure is a plain Error ("please try again"). */
const KNOWN_CODES = new Set<CampaignErrorCode>([
  "OTP_WRONG",
  "OTP_EXPIRED",
  "WINDOW_CLOSED",
  "UNAUTHORIZED",
  "TEXT_REJECTED",
  "TEXT_INVALID",
  "OTP_BLOCKED",
  "OTP_LOCKED",
  "OTP_SEND_FAILED",
  "ENTRY_LIMIT_REACHED",
]);

/** The real API, through the campaign proxy (app/api/campaign), which holds the session cookie. */
export function createHttpCampaignApi(): CampaignApi {
  async function call<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(withBasePath(`/api/campaign/${path}`), {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    const data = await res.json().catch(() => null);
    if (res.ok) return data as T;
    const { code, message, retry_after } = data?.detail ?? {};
    if (KNOWN_CODES.has(code)) throw new CampaignError(code, message, retry_after);
    if (typeof message === "string" && message) throw new CampaignServerError(message);
    // The site's firewall turns away requests that come too fast with a bare 429 and no message.
    if (res.status === 429) throw new CampaignServerError("Too many tries in a short time. Please wait a minute and try again.");
    throw new Error(`Campaign request failed (${res.status})`);
  }

  return {
    async sendOtp(phone, email) {
      const { resend_after } = await call<{ resend_after: number }>("otp/send", { phone, email });
      return { resendAfter: resend_after };
    },
    verifyOtp: (phone, email, code) => call<Session>("otp/verify", { phone, email, code }),
    async moderateText(text) {
      return (await call<{ result: ModerationResult }>("moderate", { text })).result;
    },
    async getWindowState() {
      return (await call<{ state: WindowState }>("window")).state;
    },
    async listDesigns() {
      const { added, hidden } = await call<{
        added: { design_id: string; name: string; category: Category; version: number }[];
        hidden: string[];
      }>("designs");
      return { added: added.map(({ design_id, ...rest }) => ({ designId: design_id, ...rest })), hidden };
    },
    async submitEntry({ designId, text, idempotencyKey }) {
      const { entry_id } = await call<{ entry_id: string }>("entries", {
        design_id: designId,
        text,
        idempotency_key: idempotencyKey,
      });
      return { entryId: entry_id };
    },
  };
}

export const campaignApi: CampaignApi =
  process.env.NEXT_PUBLIC_CAMPAIGN_API === "mock" ? createMockCampaignApi() : createHttpCampaignApi();
