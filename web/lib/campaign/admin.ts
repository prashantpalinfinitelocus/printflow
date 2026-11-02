/**
 * The campaign admin's own API client and types. The campaign is its own system: this talks
 * only to /user-campaign/api/admin, which carries the campaign admin's session, and nothing
 * here touches PrintFlow's login, proxy or addresses.
 */

/** Where a signed-out campaign admin signs in (served at the site root, like the campaign). */
export const LOGIN_PATH = "/user-campaign/admin/login";
export const ADMIN_HOME = "/user-campaign/admin";

/** Served at the site root with the rest of the campaign, never under PrintFlow's /offline-store. */
export const ADMIN_API = "/user-campaign/api/admin";

export class AdminApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${ADMIN_API}${path}`, { ...init, cache: "no-store" });
  if (!res.ok) {
    // A session that ended (signed out elsewhere, expired) goes back to the login.
    if (res.status === 401) window.location.assign(LOGIN_PATH);
    throw new AdminApiError(describe(await res.json().catch(() => null), res.status), res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** The API's reason in words; a refused value (FastAPI's 422) lists each field, so show the first. */
function describe(data: { detail?: unknown } | null, status: number): string {
  if (typeof data?.detail === "string") return data.detail;
  const first = Array.isArray(data?.detail) ? (data.detail[0] as { loc?: unknown[]; msg?: string }) : undefined;
  if (first?.msg) {
    const field = first.loc?.filter((part) => part !== "body").join(".");
    return field ? `${field}: ${first.msg}` : first.msg;
  }
  return `Request failed (${status})`;
}

export const adminGet = <T>(path: string) => call<T>(path);

export const adminPost = <T>(path: string, body?: unknown) =>
  call<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

export const adminPatch = <T>(path: string, body: unknown) =>
  call<T>(path, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export function adminUpload<T>(path: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  return call<T>(path, { method: "POST", body: form });
}

/** A winner's print-ready TIFF. */
export const tiffUrl = (winnerId: number) => `${ADMIN_API}/winners/${winnerId}/tiff`;

/** A day's winners sheet; its TIFF links point back at this route, so they open for a signed-in campaign admin. */
export const sheetUrl = (day: string) =>
  `${ADMIN_API}/days/${day}/winners.csv?link_base=${encodeURIComponent(`${window.location.origin}${ADMIN_API}`)}`;

/** Yesterday's date in India time (YYYY-MM-DD): the latest campaign day whose draw can have run. */
export const yesterdayInIndia = (now: Date = new Date()) => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

export type TextBox = { x: number; y: number; w: number; h: number };

/** The PSD a design's TIFFs render from and where its text goes (the campaign's own record). */
export type DesignFormat = {
  psd_path: string;
  width_px: number;
  height_px: number;
  dpi: number;
  text_box: TextBox;
  font_size: number;
  font_color: string;
  font_path: string | null;
  placeholder_color: string | null;
};

export type CampaignDesign = { design_id: string; format: DesignFormat | null };

export type Font = { filename: string; family: string | null };

export type CampaignWinner = {
  id: number;
  rank: number;
  entry_id: string;
  phone: string;
  email: string;
  design_id: string;
  text: string;
  entered_at: string;
  tiff_ready: boolean;
  tiff_error: string | null;
  tiff_generated_at: string | null;
};

export type CampaignDay = {
  day: string;
  entries: number;
  /** The day's entries have closed and it has not been drawn yet. */
  can_draw: boolean;
  draw: { eligible_entries: number; winner_count: number; created_at: string } | null;
  winners: CampaignWinner[];
  /** Winning designs with no PSD set up, so no TIFF can be made yet. */
  missing_formats: string[];
};
