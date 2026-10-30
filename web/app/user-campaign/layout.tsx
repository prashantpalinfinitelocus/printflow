import type { Metadata, Viewport } from "next";

import { canFont, headline, sans, serif, text } from "@/lib/campaign/fonts";
import { CampaignProvider } from "@/lib/campaign/store";

export const metadata: Metadata = {
  title: "Diet Coke — Make it yours",
  description: "Design your own Diet Coke can and enter the daily lucky draw.",
};

export const viewport: Viewport = { themeColor: "#ffffff" };

const FONT_VARS = [sans, serif, headline, text, canFont].map((f) => f.variable).join(" ");

export default function CampaignLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`${FONT_VARS} min-h-dvh bg-white font-[family-name:var(--dc-text)] text-black`}
    >
      {/* Designed at 402px; fills every phone up to the largest (16 Pro Max is 440), then centres. */}
      <div className="relative mx-auto min-h-dvh w-full max-w-[480px] overflow-x-hidden bg-white">
        <CampaignProvider>{children}</CampaignProvider>
      </div>
    </div>
  );
}
