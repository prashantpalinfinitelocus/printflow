import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import { CampaignProvider } from "@/lib/campaign/store";

/** The session the pages keep; the token itself lives in an httpOnly cookie. */
export const SESSION = { phone: "9876543210", email: "aanya@example.com" };

/** Renders a campaign screen with the journey state a returning tab would restore. */
export function renderCampaign(ui: ReactElement, state: Record<string, unknown> = {}) {
  sessionStorage.setItem("dc-campaign", JSON.stringify(state));
  return render(<CampaignProvider>{ui}</CampaignProvider>);
}

/** The journey state persisted for this tab. */
export const savedJourney = () => JSON.parse(sessionStorage.getItem("dc-campaign") ?? "{}");
