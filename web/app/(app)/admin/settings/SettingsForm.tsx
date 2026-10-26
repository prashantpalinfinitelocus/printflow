"use client";

import { useState } from "react";

import { Banner, Spinner } from "@/components/ui";
import { patch } from "@/lib/client";
import { dateTime } from "@/lib/format";
import type { AppSettings } from "@/lib/types";

export function SettingsForm({ initial }: { initial: AppSettings | null }) {
  const [settings, setSettings] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!settings) return <Banner kind="error">Could not load settings. Refresh to try again.</Banner>;

  async function setUppercase(value: boolean) {
    setBusy(true);
    setError(null);
    try {
      setSettings(await patch<AppSettings>("/app-settings", { uppercase_text: value }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      {error && <Banner kind="error">{error}</Banner>}

      <section className="card overflow-hidden">
        <header className="border-b border-cream-200 px-5 py-4">
          <h2 className="font-black tracking-tight">Printed text</h2>
        </header>
        <label className="flex items-start gap-3 px-5 py-4">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-[var(--color-brand-500)]"
            checked={settings.uppercase_text}
            disabled={busy}
            onChange={(e) => void setUppercase(e.target.checked)}
          />
          <span className="text-sm">
            <span className="flex items-center gap-2 font-bold">
              Print text in ALL CAPS
              {busy && <Spinner />}
            </span>
            <span className="mt-0.5 block text-ink-400">
              Order text is capitalised as CSVs are imported — &ldquo;happy birthday, riya!&rdquo; is
              stored, shown in the queue and printed as &ldquo;HAPPY BIRTHDAY, RIYA!&rdquo;. Orders
              already in the queue also print in capitals while this is on. Turning it off affects
              later imports only; text already imported in capitals stays that way.
            </span>
          </span>
        </label>
        <p className="border-t border-cream-200 px-5 py-2 text-[11px] text-ink-400">
          Last changed {dateTime(settings.updated_at)}
        </p>
      </section>
    </div>
  );
}
