import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MOCK_OTP } from "@/lib/campaign/api";
import { CampaignProvider } from "@/lib/campaign/store";
import { SESSION, gaEventNames, renderCampaign, savedJourney } from "@/test/campaign";
import { router } from "@/test/navigation";

import LandingPage from "./page";

/** The page as Next renders it: a server component given the URL's query. */
const landing = (query: Record<string, string> = {}) => LandingPage({ searchParams: Promise.resolve(query) });

describe("Landing", () => {
  const HEADLINE = "Make it official. Make it yours!";

  it("shows the Figma splash copy", async () => {
    renderCampaign(await landing());
    expect(await screen.findByRole("heading", { level: 1, name: HEADLINE })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Be on the can!" })).toBeInTheDocument();
  });

  it("shows the phone photo below 1024px and the web photo from there up", async () => {
    const { container } = renderCampaign(await landing());
    await screen.findByRole("heading", { name: HEADLINE });
    expect(container.querySelector("[data-mobile-bg]")).toHaveClass("lg:hidden");
    expect(container.querySelector("[data-web-bg]")).toHaveClass("hidden", "lg:block");
  });

  it("starts the phone photo above the screen, where Figma's mocked browser bar sits", async () => {
    const { container } = renderCampaign(await landing());
    await screen.findByRole("heading", { name: HEADLINE });
    expect(container.querySelector("[data-mobile-bg]")).toHaveClass("top-[-99px]");
  });

  it("stands the can up on phones, filling the space above the button, and tilts it clockwise on web", async () => {
    const { container } = renderCampaign(await landing());
    await screen.findByRole("heading", { name: HEADLINE });
    const can = container.querySelector("[data-can]");
    expect(can).toHaveClass("top-[168px]", "h-[calc(100dvh-352px)]", "lg:h-[72.35dvh]", "lg:rotate-[17.91deg]");
    expect(decodeURIComponent(can!.querySelector("img")!.getAttribute("src")!)).toMatch(/landing-can/);
  });

  it("preloads only the photo each screen size shows, so phones never fetch the web photo and vice versa", async () => {
    renderCampaign(await landing());
    await screen.findByRole("heading", { name: HEADLINE });
    const preloads = [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="image"]')];
    const srcs = (media: string) =>
      preloads.filter((l) => l.media === media).map((l) => l.getAttribute("imagesrcset") ?? l.href).join();
    expect(srcs("(max-width: 1023px)")).toMatch(/mobile-bg/);
    expect(srcs("(min-width: 1024px)")).toMatch(/web-landing-bg/);
    // No unscoped preload: that would make every device download every photo.
    expect(preloads.filter((l) => !l.media)).toHaveLength(0);
  });

  it("places the headline, button and legal links where the web design does", async () => {
    renderCampaign(await landing());
    const heading = await screen.findByRole("heading", { name: HEADLINE });
    expect(heading).toHaveClass("lg:absolute", "lg:left-[59.03%]", "lg:top-[37.28%]", "lg:w-[401px]");
    expect(screen.getByRole("navigation", { name: "Legal" })).toHaveClass("lg:absolute", "lg:bottom-8", "lg:right-8");
    expect(screen.getByRole("button", { name: "Be on the can!" })).toHaveClass("lg:top-[56.39%]", "lg:h-14", "lg:w-[326px]");
  });

  it("on tablets spreads the photo edge to edge but keeps the headline and button in a centred phone-width column", async () => {
    const { container } = renderCampaign(await landing());
    const heading = await screen.findByRole("heading", { name: HEADLINE });
    expect(heading).toHaveClass("max-w-[354px]");
    expect(container.querySelector("[data-foot]")).toHaveClass("px-[max(24px,calc(50%-177px))]");
    // The photo is asked for at the screen's width, so a tablet never stretches a phone-sized one.
    const phone = document.head.querySelector('link[rel="preload"][media="(max-width: 1023px)"]');
    expect(phone?.getAttribute("imagesizes")).toBe("100vw");
  });

  it("never dims the button while the saved session is read", async () => {
    renderCampaign(await landing());
    expect(await screen.findByRole("button", { name: "Be on the can!" })).toHaveClass("disabled:opacity-100");
  });

  it("serves every image at quality 90, and preloads the same files", async () => {
    const { container } = renderCampaign(await landing());
    await screen.findByRole("heading", { name: "Make it official. Make it yours!" });
    for (const img of container.querySelectorAll("img")) expect(img.getAttribute("src")).toMatch(/\?q=90$/);
    for (const l of document.head.querySelectorAll('link[rel="preload"][as="image"]')) expect(l.getAttribute("imagesrcset")).toMatch(/\?q=90 /);
  });

  it("links to the terms and privacy policy", async () => {
    renderCampaign(await landing());
    expect(await screen.findByRole("link", { name: "Terms & Conditions" })).toHaveAttribute("href", "/user-campaign/terms");
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/user-campaign/privacy");
  });

  it("asks a new visitor to log in before customising", async () => {
    renderCampaign(await landing());
    await userEvent.click(await screen.findByRole("button", { name: "Be on the can!" }));
    expect(screen.getByRole("dialog", { name: "Login" })).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("sends a logged-in visitor straight to the customiser", async () => {
    renderCampaign(await landing(), { session: SESSION });
    await userEvent.click(await screen.findByRole("button", { name: "Be on the can!" }));
    expect(router.push).toHaveBeenCalledWith("/user-campaign/create");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("server-renders the splash with the CTA disabled until the saved session is known", async () => {
    const html = renderToString(<CampaignProvider>{await landing()}</CampaignProvider>);
    const page = document.createElement("div");
    page.innerHTML = html;
    // getByRole throws if the splash is missing from the server HTML (a client-only bail-out).
    within(page).getByRole("heading", { name: "Make it official. Make it yours!" });
    expect(within(page).getByRole("button", { name: "Be on the can!" })).toBeDisabled();
  });

  it("opens login straight away when sent back with ?login=1", async () => {
    renderCampaign(await landing({ login: "1" }));
    expect(await screen.findByRole("dialog", { name: "Login" })).toBeInTheDocument();
  });

  it("does not reopen login on ?login=1 for a visitor who is already logged in", async () => {
    renderCampaign(await landing({ login: "1" }), { session: SESSION });
    await screen.findByRole("button", { name: "Be on the can!" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("saves the session and moves on once the OTP is verified", async () => {
    const user = userEvent.setup();
    renderCampaign(await landing());
    await user.click(await screen.findByRole("button", { name: "Be on the can!" }));
    await user.type(screen.getByLabelText("Your mobile number"), "9876543210");
    await user.type(screen.getByLabelText("Your email ID"), "aanya@example.com");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Submit" }));
    await user.type(await screen.findByLabelText("6-digit code", {}, { timeout: 2000 }), MOCK_OTP);
    await user.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/user-campaign/create"), { timeout: 2000 });
    await waitFor(() => expect(savedJourney().session).toMatchObject({ phone: "9876543210" }));
  });
});

describe("analytics", () => {
  it("counts one landing view", async () => {
    renderCampaign(await landing());
    await screen.findByRole("button", { name: "Be on the can!" });
    expect(gaEventNames()).toEqual(["campaign_landing_viewed"]);
  });

  it("counts the CTA click and the login screen it opens", async () => {
    renderCampaign(await landing());
    await waitFor(() => expect(screen.getByRole("button", { name: "Be on the can!" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Be on the can!" }));
    await screen.findByRole("dialog", { name: "Login" });
    expect(gaEventNames()).toEqual(["campaign_landing_viewed", "campaign_cta_clicked", "login_screen_viewed"]);
  });

  it("counts the CTA click of a visitor who is already logged in", async () => {
    renderCampaign(await landing(), { session: SESSION });
    await waitFor(() => expect(screen.getByRole("button", { name: "Be on the can!" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Be on the can!" }));
    expect(gaEventNames()).toEqual(["campaign_landing_viewed", "campaign_cta_clicked"]);
  });
});
