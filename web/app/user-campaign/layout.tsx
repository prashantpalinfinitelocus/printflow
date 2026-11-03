import type { Metadata, Viewport } from "next";

import { CampaignAnalytics } from "@/lib/campaign/analytics";
import { canFont, sans, serif } from "@/lib/campaign/fonts";
import { CampaignProvider } from "@/lib/campaign/store";

import "./campaign.css";
import "./fonts.css";

export const metadata: Metadata = {
  title: "Diet Coke - Make it yours",
  description: "Design your own Diet Coke can and enter the daily lucky draw.",
};

export const viewport: Viewport = { themeColor: "#ffffff" };

const FONT_VARS = [sans, serif, canFont].map((f) => f.variable).join(" ");

export default function CampaignLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`${FONT_VARS} dc-fonts min-h-dvh bg-white font-[family-name:var(--dc-text)] text-black`}
    >
      {/* Designed at 402px for phones and 1440 × 900 for web (1024px up). Every screen fills the full width; on tablets each page keeps its controls in a centred phone-width column. */}
      <div className="relative min-h-dvh w-full overflow-x-hidden bg-white">
        <CampaignAnalytics />
        <CampaignProvider>{children}</CampaignProvider>
      </div>
    </div>
  );
}
