import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MOCK_OTP } from "@/lib/campaign/api";
import { CampaignProvider } from "@/lib/campaign/store";
import { SESSION, renderCampaign, savedJourney } from "@/test/campaign";
import { router } from "@/test/navigation";

import LandingPage from "./page";

/** The page as Next renders it: a server component given the URL's query. */
const landing = (query: Record<string, string> = {}) => LandingPage({ searchParams: Promise.resolve(query) });

describe("Landing", () => {
  it("shows the Figma splash copy", async () => {
    renderCampaign(await landing());
    expect(await screen.findByRole("heading", { name: "Make it yours" })).toBeInTheDocument();
    expect(screen.getByText(/only a lucky few dc paglus score one/i)).toBeInTheDocument();
  });

  it("adds Figma's web backdrop and can photo from 1024px, hidden on phones", async () => {
    const { container } = renderCampaign(await landing());
    await screen.findByRole("heading", { name: "Make it yours" });
    const web = container.querySelector("[data-web-backdrop]");
    expect(web).toHaveClass("hidden", "lg:block");
    expect(web?.querySelectorAll("img")).toHaveLength(2);
    // The phone hero and its white fade give way to the web backdrop.
    expect(container.querySelector("[data-mobile-hero]")).toHaveClass("lg:hidden");
  });

  it("preloads only the photos each screen size shows, so phones never fetch the web backdrop and vice versa", async () => {
    renderCampaign(await landing());
    await screen.findByRole("heading", { name: "Make it yours" });
    const preloads = [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="image"]')];
    const phone = preloads.filter((l) => l.media === "(max-width: 1023px)");
    const web = preloads.filter((l) => l.media === "(min-width: 1024px)");
    expect(phone.map((l) => l.getAttribute("imagesrcset") ?? l.href).join()).toMatch(/hero/);
    expect(web.map((l) => l.getAttribute("imagesrcset") ?? l.href).join()).toMatch(/web-bg/);
    expect(web.map((l) => l.getAttribute("imagesrcset") ?? l.href).join()).toMatch(/web-hands/);
    // No unscoped preload: that would make every device download every photo.
    expect(preloads.filter((l) => !l.media)).toHaveLength(0);
  });

  it("places the copy and legal links where the web design does", async () => {
    renderCampaign(await landing());
    const heading = await screen.findByRole("heading", { name: "Make it yours" });
    expect(heading.closest("[data-copy]")).toHaveClass("lg:absolute", "lg:left-[57.08%]", "lg:top-[37%]", "lg:w-[466px]", "lg:gap-11");
    expect(screen.getByRole("navigation", { name: "Legal" })).toHaveClass("lg:absolute", "lg:bottom-8", "lg:left-[65.28%]");
    expect(screen.getByRole("button", { name: /set the vibes/i })).toHaveClass("lg:mx-auto", "lg:w-[280px]");
    expect(screen.getByText("Your DC. Your Vibe")).toHaveClass("lg:text-base", "lg:tracking-normal");
  });

  it("links to the terms and privacy policy", async () => {
    renderCampaign(await landing());
    expect(await screen.findByRole("link", { name: "Terms & Conditions" })).toHaveAttribute("href", "/user-campaign/terms");
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/user-campaign/privacy");
  });

  it("asks a new visitor to log in before customising", async () => {
    renderCampaign(await landing());
    await userEvent.click(await screen.findByRole("button", { name: "Let’s set the vibes" }));
    expect(screen.getByRole("dialog", { name: "Login" })).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("sends a logged-in visitor straight to the customiser", async () => {
    renderCampaign(await landing(), { session: SESSION });
    await userEvent.click(await screen.findByRole("button", { name: "Let’s set the vibes" }));
    expect(router.push).toHaveBeenCalledWith("/user-campaign/create");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("server-renders the splash with the CTA disabled until the saved session is known", async () => {
    const html = renderToString(<CampaignProvider>{await landing()}</CampaignProvider>);
    const page = document.createElement("div");
    page.innerHTML = html;
    // getByRole throws if the splash is missing from the server HTML (a client-only bail-out).
    within(page).getByRole("heading", { name: "Make it yours" });
    expect(within(page).getByRole("button", { name: "Let’s set the vibes" })).toBeDisabled();
  });

  it("opens login straight away when sent back with ?login=1", async () => {
    renderCampaign(await landing({ login: "1" }));
    expect(await screen.findByRole("dialog", { name: "Login" })).toBeInTheDocument();
  });

  it("does not reopen login on ?login=1 for a visitor who is already logged in", async () => {
    renderCampaign(await landing({ login: "1" }), { session: SESSION });
    await screen.findByRole("button", { name: "Let’s set the vibes" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("saves the session and moves on once the OTP is verified", async () => {
    const user = userEvent.setup();
    renderCampaign(await landing());
    await user.click(await screen.findByRole("button", { name: "Let’s set the vibes" }));
    await user.type(screen.getByLabelText("Your mobile number"), "9876543210");
    await user.type(screen.getByLabelText("your email ID"), "aanya@example.com");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Submit" }));
    await user.type(await screen.findByLabelText("6-digit code", {}, { timeout: 2000 }), MOCK_OTP);
    await user.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/user-campaign/create"), { timeout: 2000 });
    await waitFor(() => expect(savedJourney().session).toMatchObject({ phone: "9876543210" }));
  });
});
