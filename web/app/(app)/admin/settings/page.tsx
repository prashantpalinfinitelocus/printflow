import { PageHeader } from "@/components/Shell";
import { apiJson } from "@/lib/session";
import type { AppSettings } from "@/lib/types";

import { SettingsForm } from "./SettingsForm";

export default async function SettingsPage() {
  const settings = await apiJson<AppSettings>("/app-settings");

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Settings"
        description="App-wide behaviour. Changes apply to every store from the next print — no redeploy needed."
      />
      <SettingsForm initial={settings} />
    </>
  );
}
