import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MOCK_OTP } from "@/lib/campaign/api";
import { CampaignProvider } from "@/lib/campaign/store";
import { SESSION, renderCampaign, savedJourney } from "@/test/campaign";
import { router, searchParams } from "@/test/navigation";

import LandingPage from "./page";

describe("Landing", () => {
  it("shows the Figma splash copy", async () => {
    renderCampaign(<LandingPage />);
    expect(await screen.findByRole("heading", { name: "Make it yours." })).toBeInTheDocument();
    expect(screen.getByText(/only a lucky few dc paglus score one/i)).toBeInTheDocument();
  });

  it("links to the terms and privacy policy", async () => {
    renderCampaign(<LandingPage />);
    expect(await screen.findByRole("link", { name: "Terms & Conditions" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toBeInTheDocument();
  });

  it("asks a new visitor to log in before customising", async () => {
    renderCampaign(<LandingPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Let’s set the vibes" }));
    expect(screen.getByRole("dialog", { name: "Login" })).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("sends a logged-in visitor straight to the customiser", async () => {
    renderCampaign(<LandingPage />, { session: SESSION });
    await userEvent.click(await screen.findByRole("button", { name: "Let’s set the vibes" }));
    expect(router.push).toHaveBeenCalledWith("/campaign/create");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the CTA disabled in the server HTML, before the saved session is known", () => {
    const html = renderToString(
      <CampaignProvider>
        <LandingPage />
      </CampaignProvider>,
    );
    const page = document.createElement("div");
    page.innerHTML = html;
    expect(within(page).getByRole("button", { name: "Let’s set the vibes" })).toBeDisabled();
  });

  it("opens login straight away when sent back with ?login=1", async () => {
    searchParams.value = new URLSearchParams("login=1");
    renderCampaign(<LandingPage />);
    expect(await screen.findByRole("dialog", { name: "Login" })).toBeInTheDocument();
  });

  it("saves the session and moves on once the OTP is verified", async () => {
    const user = userEvent.setup();
    renderCampaign(<LandingPage />);
    await user.click(await screen.findByRole("button", { name: "Let’s set the vibes" }));
    await user.type(screen.getByLabelText("Your mobile number"), "9876543210");
    await user.type(screen.getByLabelText("your email ID"), "aanya@example.com");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Submit" }));
    await user.type(await screen.findByLabelText("6-digit code", {}, { timeout: 2000 }), MOCK_OTP);
    await user.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/campaign/create"), { timeout: 2000 });
    await waitFor(() => expect(savedJourney().session).toMatchObject({ phone: "9876543210" }));
  });
});
