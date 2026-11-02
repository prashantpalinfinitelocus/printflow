import type { Metadata } from "next";

import { AdminApp } from "./AdminApp";

export const metadata: Metadata = { title: "Daily winners", robots: { index: false, follow: false } };

/** The campaign's admin: each day's lucky draw, the winners sheet, their TIFFs and the design PSDs. */
export default function AdminPage() {
  // The day the panel opens on is worked out in the browser (AdminApp): this page is built once,
  // so a date computed here would stay the build's "yesterday" until the next deploy.
  return <AdminApp />;
}
