export type Role = "ADMIN" | "OPERATOR";
export type OrderStatus = "PENDING" | "PRINTING" | "PRINTED" | "FAILED";
export type JobKind = "TIFF" | "PDF";
export type JobStatus = "QUEUED" | "RENDERED" | "SENT_TO_PRINTER" | "DOWNLOADED" | "FAILED";
/** Where the order's text stands with the LLM brand-safety gate — see the API's ModerationStatus. */
export type ModerationStatus =
  | "UNCHECKED"
  | "CLEAR"
  | "FLAGGED"
  | "NEEDS_REVIEW"
  | "APPROVED"
  | "REJECTED";
/** Statuses in which the API refuses to render or print. */
export const HELD_STATUSES: ReadonlySet<ModerationStatus> = new Set(["FLAGGED", "NEEDS_REVIEW", "REJECTED"]);
export const isHeld = (status: ModerationStatus) => HELD_STATUSES.has(status);
/** How the rendered file reaches paper — see the API's Delivery enum. */
export type Delivery = "PRINTER" | "DOWNLOAD" | "PROOF";

export interface Store {
  id: number;
  code: string;
  name: string;
  city: string | null;
  is_active: boolean;
  created_at: string;
  user_count?: number;
  pending_orders?: number;
}

export interface User {
  id: number;
  email: string;
  full_name: string | null;
  role: Role;
  store_id: number | null;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
  store?: Store | null;
}

export interface TextBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PrintFormat {
  id: number;
  code: string;
  name: string;
  psd_path: string;
  width_px: number;
  height_px: number;
  dpi: number;
  text_box: TextBox;
  text_layer_name: string | null;
  font_size: number;
  font_color: string;
  align: string;
  font_path: string | null;
  placeholder_color: string | null;
  colorspace: string | null;
  preserve_alpha: boolean;
  /** Paper the label is centred on in the TIFF/PDF. Null emits a label-sized file. */
  page_size: string | null;
  /** Times this design must be printed onto the same object to build opacity. */
  print_passes: number;
  /** Passes of white ink emitted as spot channels. 0 = plain RGBA file. */
  white_passes: number;
  is_active: boolean;
}

export interface Font {
  filename: string;
  family: string | null;
}

export interface DetectPlaceholderResponse {
  text_box: TextBox;
  fill: number;
}

export interface Order {
  id: number;
  order_ref: string;
  store_id: number;
  /** Snapshots of what the CSV called the store; `store` holds the master's own values. */
  store_name: string | null;
  city: string | null;
  sku_code: string | null;
  brand: string | null;
  amount: string;
  print_format_id: number;
  print_text: string;
  status: OrderStatus;
  reprint_count: number;
  created_at: string;
  printed_at: string | null;
  last_error: string | null;
  moderation_status: ModerationStatus;
  moderation_categories: string[] | null;
  /** The model's one-line reason when flagged, or the error when it was unavailable. */
  moderation_reason: string | null;
  /** Free text the reviewing admin left. */
  moderation_note: string | null;
  moderated_at: string | null;
  store: Store | null;
  print_format: PrintFormat | null;
  printed_by: User | null;
  reviewed_by: User | null;
}

export interface OrderPage {
  items: Order[];
  total: number;
  page: number;
  page_size: number;
}

export interface OrderStats {
  pending: number;
  printing: number;
  printed: number;
  failed: number;
  /** Held by moderation. Overlaps with `pending`. */
  on_hold: number;
  total: number;
  amount_pending: string;
}

export interface Printer {
  name: string;
  status: string;
  is_default: boolean;
}

export interface PrintJob {
  id: number;
  order_id: number;
  kind: JobKind;
  is_reprint: boolean;
  /** This job printed the artwork blank — the only route past a moderation hold. */
  without_text: boolean;
  printer_name: string | null;
  status: JobStatus;
  passes: number;
  /** Point size the text was actually drawn at — font_size is only a ceiling. */
  font_size_used: number | null;
  cups_job_id: string | null;
  error: string | null;
  created_at: string;
  user: User | null;
}

export interface PrintResponse {
  job: PrintJob;
  order: Order;
  tiff_url: string | null;
  pdf_url: string | null;
  preview_url: string | null;
  /** Set when the text contained characters no installed font could draw. */
  warning: string | null;
}

export interface CsvBatch {
  id: number;
  filename: string;
  source: string;
  total_rows: number;
  imported: number;
  skipped: number;
  /** Imported but held by moderation. */
  flagged: number;
  errors: { row: number; order_ref: string | null; reason: string }[];
  moderation_prompt_tokens: number;
  moderation_output_tokens: number;
  moderation_thought_tokens: number;
  created_at: string;
  uploaded_by: User | null;
}

export interface InboxFile {
  name: string;
  size: number;
  modified: string;
}

export type PageSize = {
  name: string;
  width_in: number;
  height_in: number;
};

export type FitText = {
  font_size_used: number;
  font_size_used_pt: number;
  requested_pt: number;
  capped: boolean;
  lines: number;
  line_height: number;
  line_height_mm: number;
  /** Box the requested size needs on one line — the actionable number. */
  min_box_width: number;
  min_box_height: number;
};
