import type { Metadata, Viewport } from "next";

import { canFont, sans, serif } from "@/lib/campaign/fonts";
import { CampaignProvider } from "@/lib/campaign/store";

export const metadata: Metadata = {
  title: "Diet Coke — Make it yours",
  description: "Design your own Diet Coke can and enter the daily lucky draw.",
};

export const viewport: Viewport = { themeColor: "#ffffff" };

export default function CampaignLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`${sans.variable} ${serif.variable} ${canFont.variable} min-h-dvh bg-white font-[family-name:var(--dc-sans)] text-black`}
    >
      {/* The design is a 402px phone screen; wider viewports get it centred. */}
      <div className="relative mx-auto min-h-dvh w-full max-w-[430px] overflow-x-hidden bg-white">
        <CampaignProvider>{children}</CampaignProvider>
      </div>
    </div>
  );
}
