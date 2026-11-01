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

  it("keeps Figma's phone photo on phones and uses the web backdrop and can cut-out from 481px", async () => {
    const { container } = renderCampaign(await landing());
    await screen.findByRole("heading", { name: "Make it yours" });
    const web = container.querySelector("[data-web-backdrop]");
    expect(web).toHaveClass("hidden", "min-[481px]:block");
    expect(web?.querySelectorAll("img")).toHaveLength(2);
    expect(container.querySelector("[data-mobile-hero]")).toHaveClass("min-[481px]:hidden");
    // Phones and tablets fade the photo into the white behind the copy; the web design has no fade.
    expect(container.querySelector("[data-fade]")).toHaveClass("lg:hidden");
  });

  it("on tablets fits the whole can-in-hands cut-out above the copy, centred", async () => {
    const { container } = renderCampaign(await landing());
    await screen.findByRole("heading", { name: "Make it yours" });
    const hands = container.querySelectorAll("[data-web-backdrop] img")[1];
    // Always the full height above the copy, so the cut wrist sits under the white fade; on a
    // narrow tablet the sides run off the screen rather than the photo shrinking and showing its edges.
    expect(hands).toHaveClass("top-0", "left-1/2", "-translate-x-1/2", "h-[calc(100dvh-200px)]");
  });

  it("on web always runs the cut-out off the foot of the screen, sliding it left on narrow screens rather than shrinking it", async () => {
    const { container } = renderCampaign(await landing());
    await screen.findByRole("heading", { name: "Make it yours" });
    const hands = container.querySelectorAll("[data-web-backdrop] img")[1];
    // 116.11dvh tall (Figma 1045 of 900), so the cut wrist is always below the screen; its right
    // edge stays left of 65.28%, where Figma's ends, so the hand never runs into the copy.
    expect(hands).toHaveClass("lg:h-[116.11dvh]", "lg:top-[-0.44%]", "lg:left-[min(5.69%,calc(65.28%-95.3dvh))]", "lg:translate-x-0");
  });

  it("preloads only the photos each screen size shows, so phones never fetch the web backdrop and vice versa", async () => {
    renderCampaign(await landing());
    await screen.findByRole("heading", { name: "Make it yours" });
    const preloads = [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="image"]')];
    const phone = preloads.filter((l) => l.media === "(max-width: 480px)");
    const web = preloads.filter((l) => l.media === "(min-width: 481px)");
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

  it("on tablets spreads the photo edge to edge but keeps the copy and button in a centred phone-width column", async () => {
    const { container } = renderCampaign(await landing());
    await screen.findByRole("heading", { name: "Make it yours" });
    expect(container.querySelector("[data-copy]")?.parentElement).toHaveClass("px-[max(24px,calc(50%-216px))]");
    // The hero is asked for at the screen's width, so a tablet never stretches a phone-sized photo.
    const phone = document.head.querySelector('link[rel="preload"][media="(max-width: 480px)"]');
    expect(phone?.getAttribute("imagesizes")).toBe("120vw");
  });

  it("serves every image at quality 90, and preloads the same files", async () => {
    const { container } = renderCampaign(await landing());
    await screen.findByRole("heading", { name: "Make it yours" });
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
