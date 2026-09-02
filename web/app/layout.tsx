import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "PrintFlow — store print queue",
  description: "CSV-driven print order queue with PSD composition and TIFF/PDF output.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-[var(--font-display)] antialiased">{children}</body>
    </html>
  );
}
