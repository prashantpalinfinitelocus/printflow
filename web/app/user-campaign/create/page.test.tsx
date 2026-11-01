import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CampaignError, CampaignServerError, campaignApi } from "@/lib/campaign/api";
import { SESSION, renderCampaign, savedJourney } from "@/test/campaign";
import { router } from "@/test/navigation";

import CreatePage from "./page";

const LOGGED_IN = { session: SESSION, headsUpSeen: true };
const textField = () => screen.findByRole("textbox");

afterEach(() => vi.restoreAllMocks());

describe("access", () => {
  it("sends a visitor without a session back to log in", async () => {
    renderCampaign(<CreatePage />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/user-campaign?login=1"));
  });
});

describe("heads-up popup", () => {
  it("explains the entry window and the draw on the first visit", async () => {
    renderCampaign(<CreatePage />, { session: SESSION });
    const dialog = await screen.findByRole("dialog", { name: "Quick Heads-Up!" });
    expect(dialog).toHaveTextContent("Your main-character moment starts at 10AM and ends at 10PM")
    expect(dialog).not.toHaveTextContent("IST");
    expect(dialog).toHaveTextContent(/not every entry makes the cut/i);
  });

  it("stays dismissed once acknowledged", async () => {
    renderCampaign(<CreatePage />, { session: SESSION });
    await userEvent.click(await screen.findByRole("button", { name: "Let’s Do This" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(savedJourney().headsUpSeen).toBe(true));
  });

  it("does not reappear for a visitor who has seen it", async () => {
    renderCampaign(<CreatePage />, LOGGED_IN);
    await textField();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("tablet layout (481px to 1023px)", () => {
  it("runs the white sheet edge to edge with the field, designs and button in a centred phone-width column", async () => {
    const { container } = renderCampaign(<CreatePage />, LOGGED_IN);
    await textField();
    expect(container.querySelector("form")).toHaveClass("inset-x-0", "px-[max(19px,calc(50%-221px))]");
  });
});

describe("short laptop screens (under 900px tall)", () => {
  it("keeps the text card and a two-line status message on screen, with the can 32px above the card as in Figma", async () => {
    const { container } = renderCampaign(<CreatePage />, LOGGED_IN);
    const card = (await textField()).closest("label")!.parentElement!.parentElement!;
    // Card, counter and the two-line rejection message take 148px; 176px keeps them 28px off the foot,
    // the room Figma leaves under its one-line message.
    expect(card).toHaveClass("lg:top-[min(82.11dvh,calc(100dvh-176px))]");
    // The can (from 10.33dvh) ends 32px above the card, so it shrinks with the screen rather than overlap.
    const can = container.querySelector('[role="img"]')!.parentElement!;
    expect(can).toHaveClass("lg:top-[10.33dvh]", "lg:h-[min(68.22dvh,calc(89.67dvh-208px))]");
  });
});

describe("image quality", () => {
  it("serves the can, stickers and logo at quality 90", async () => {
    const { container } = renderCampaign(<CreatePage />, LOGGED_IN);
    await textField();
    const imgs = [...container.querySelectorAll("img")];
    expect(imgs.length).toBeGreaterThan(10);
    for (const img of imgs) expect(img.getAttribute("src")).toMatch(/\?q=90$/);
  });
});

describe("text and design", () => {
  it("counts characters against the limit as you type", async () => {
    renderCampaign(<CreatePage />, LOGGED_IN);
    await userEvent.type(await textField(), "Aanya");
    expect(screen.getByText("5/12")).toBeInTheDocument();
  });

  it("stops accepting characters at the limit", async () => {
    renderCampaign(<CreatePage />, LOGGED_IN);
    const field = await textField();
    await userEvent.type(field, "Happy birthday Riya");
    expect(field).toHaveValue("Happy birthd");
    expect(screen.getByText("12/12")).toBeInTheDocument();
  });

  it("shows the text on the can as it is typed", async () => {
    renderCampaign(<CreatePage />, LOGGED_IN);
    await userEvent.type(await textField(), "Aanya");
    expect(screen.getByRole("img", { name: /aanya/i })).toBeInTheDocument();
  });

  it("lets you pick a vibe and remembers it", async () => {
    renderCampaign(<CreatePage />, LOGGED_IN);
    const disco = await screen.findByRole("radio", { name: "Disco ball" });
    await userEvent.click(disco);
    expect(disco).toBeChecked();
    expect(screen.getByRole("radio", { name: "Clinking bottles" })).not.toBeChecked();
    await waitFor(() => expect(savedJourney().designId).toBe("DISCO_BALL"));
  });
});

describe("Check my vibe", () => {
  it("asks for text before checking anything", async () => {
    const moderate = vi.spyOn(campaignApi, "moderateText");
    renderCampaign(<CreatePage />, LOGGED_IN);
    await userEvent.click(await screen.findByRole("button", { name: "Check my vibe" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/add a name/i);
    expect(moderate).not.toHaveBeenCalled();
  });

  it("rejects emoji before it reaches moderation", async () => {
    renderCampaign(<CreatePage />, LOGGED_IN);
    await userEvent.type(await textField(), "Hi 🎉");
    await userEvent.click(screen.getByRole("button", { name: "Check my vibe" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/emoji/i);
  });

  it("goes to the preview once moderation approves the text", async () => {
    renderCampaign(<CreatePage />, LOGGED_IN);
    await userEvent.type(await textField(), "  Aanya ");
    await userEvent.click(screen.getByRole("button", { name: "Check my vibe" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/user-campaign/preview"), { timeout: 2000 });
    expect(savedJourney()).toMatchObject({ text: "Aanya", approvedText: "Aanya" });
  });

  it("shows the friendly-content popup when moderation rejects the text", async () => {
    renderCampaign(<CreatePage />, LOGGED_IN);
    await userEvent.type(await textField(), "stupid");
    await userEvent.click(screen.getByRole("button", { name: "Check my vibe" }));
    expect(await screen.findByRole("dialog", { name: "Let’s keep it friendly" }, { timeout: 2000 })).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("returns to the text field from the friendly-content popup", async () => {
    renderCampaign(<CreatePage />, LOGGED_IN);
    const field = await textField();
    await userEvent.type(field, "stupid");
    await userEvent.click(screen.getByRole("button", { name: "Check my vibe" }));
    await userEvent.click(await screen.findByRole("button", { name: "Edit Text" }, { timeout: 2000 }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(field).toHaveFocus();
  });

  it("keeps the design and asks to retry when the checker is down — never bypasses it", async () => {
    vi.spyOn(campaignApi, "moderateText").mockRejectedValueOnce(new Error("timeout"));
    renderCampaign(<CreatePage />, LOGGED_IN);
    await userEvent.type(await textField(), "Aanya");
    await userEvent.click(screen.getByRole("button", { name: "Check my vibe" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/message checker needs a moment/i);
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toHaveValue("Aanya");
  });

  it("sends an expired session back to log in, keeping the design and text", async () => {
    vi.spyOn(campaignApi, "moderateText").mockRejectedValueOnce(new CampaignError("UNAUTHORIZED", "expired"));
    renderCampaign(<CreatePage />, { ...LOGGED_IN, designId: "DISCO_BALL" });
    await userEvent.type(await textField(), "Aanya");
    await userEvent.click(screen.getByRole("button", { name: "Check my vibe" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/user-campaign?login=1"));
    expect(savedJourney()).toMatchObject({ session: null, text: "Aanya", designId: "DISCO_BALL" });
  });

  it("opens the friendly-content popup when sent back after a rejection at submit", async () => {
    renderCampaign(<CreatePage />, { ...LOGGED_IN, text: "Aanya", textRejected: true });
    expect(await screen.findByRole("dialog", { name: "Let’s keep it friendly" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Edit Text" }));
    await waitFor(() => expect(savedJourney().textRejected).toBe(false));
  });

  it("shows the server's reason when the text check fails", async () => {
    vi.spyOn(campaignApi, "moderateText").mockRejectedValueOnce(
      new CampaignServerError("We can’t reach the campaign right now. Please try again."),
    );
    renderCampaign(<CreatePage />, LOGGED_IN);
    await userEvent.type(await textField(), "Aanya");
    await userEvent.click(screen.getByRole("button", { name: "Check my vibe" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("We can’t reach the campaign right now.");
  });

  it("skips a second check for text that was already approved", async () => {
    const moderate = vi.spyOn(campaignApi, "moderateText");
    renderCampaign(<CreatePage />, { ...LOGGED_IN, text: "Aanya", approvedText: "Aanya" });
    await userEvent.click(await screen.findByRole("button", { name: "Check my vibe" }));
    expect(router.push).toHaveBeenCalledWith("/user-campaign/preview");
    expect(moderate).not.toHaveBeenCalled();
  });

  it("re-checks text edited after approval", async () => {
    const moderate = vi.spyOn(campaignApi, "moderateText");
    renderCampaign(<CreatePage />, { ...LOGGED_IN, text: "Aanya", approvedText: "Aanya" });
    await userEvent.type(await textField(), "!");
    await userEvent.click(screen.getByRole("button", { name: "Check my vibe" }));
    expect(moderate).toHaveBeenCalledWith("Aanya!");
  });
});

describe("live check while typing", () => {
  const FRIENDLY = /isn’t quite the Diet Coke vibe/i;
  const status = () => screen.queryByTestId("live-check");

  it("checks the text after a pause and says it looks good, without any click", async () => {
    const moderate = vi.spyOn(campaignApi, "moderateText").mockResolvedValue("APPROVED");
    renderCampaign(<CreatePage />, LOGGED_IN);
    await userEvent.type(await textField(), "Aanya");

    expect(await screen.findByText(/looks good/i, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(moderate).toHaveBeenCalledTimes(1);
    expect(moderate).toHaveBeenCalledWith("Aanya");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("says so in the field when the text is flagged, before any click", async () => {
    vi.spyOn(campaignApi, "moderateText").mockResolvedValue("REJECTED");
    renderCampaign(<CreatePage />, LOGGED_IN);
    await userEvent.type(await textField(), "stupid");

    expect(await screen.findByText(FRIENDLY, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
  });

  it("opens the friendly-content popup on submit from the flagged verdict, without asking again", async () => {
    const moderate = vi.spyOn(campaignApi, "moderateText").mockResolvedValue("REJECTED");
    renderCampaign(<CreatePage />, LOGGED_IN);
    await userEvent.type(await textField(), "stupid");
    await screen.findByText(FRIENDLY, {}, { timeout: 3000 });

    await userEvent.click(screen.getByRole("button", { name: "Check my vibe" }));

    expect(await screen.findByRole("dialog", { name: "Let’s keep it friendly" })).toBeInTheDocument();
    expect(moderate).toHaveBeenCalledTimes(1);
  });

  it("goes straight to the preview from an approved live verdict, without asking again", async () => {
    const moderate = vi.spyOn(campaignApi, "moderateText").mockResolvedValue("APPROVED");
    renderCampaign(<CreatePage />, LOGGED_IN);
    await userEvent.type(await textField(), "Aanya");
    await screen.findByText(/looks good/i, {}, { timeout: 3000 });

    await userEvent.click(screen.getByRole("button", { name: "Check my vibe" }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/user-campaign/preview"));
    expect(moderate).toHaveBeenCalledTimes(1);
    expect(savedJourney()).toMatchObject({ text: "Aanya", approvedText: "Aanya" });
  });

  it("asks once even when the button is pressed while the live check is still running", async () => {
    let finish!: (v: "APPROVED") => void;
    const moderate = vi.spyOn(campaignApi, "moderateText").mockImplementation(() => new Promise((r) => (finish = r)));
    renderCampaign(<CreatePage />, LOGGED_IN);
    await userEvent.type(await textField(), "Aanya");
    await waitFor(() => expect(moderate).toHaveBeenCalledTimes(1), { timeout: 3000 });

    await userEvent.click(screen.getByRole("button", { name: "Check my vibe" }));
    finish("APPROVED");

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/user-campaign/preview"));
    expect(moderate).toHaveBeenCalledTimes(1);
  });

  it("waits for a pause: fast typing sends one request for the final text", async () => {
    const moderate = vi.spyOn(campaignApi, "moderateText").mockResolvedValue("APPROVED");
    renderCampaign(<CreatePage />, LOGGED_IN);
    await userEvent.type(await textField(), "Aanya");
    await screen.findByText(/looks good/i, {}, { timeout: 3000 });

    expect(moderate.mock.calls).toEqual([["Aanya"]]);
  });

  it("does not send text that fails the local rules", async () => {
    const moderate = vi.spyOn(campaignApi, "moderateText").mockResolvedValue("APPROVED");
    renderCampaign(<CreatePage />, LOGGED_IN);
    await userEvent.type(await textField(), "Hi 🎉");
    await new Promise((r) => setTimeout(r, 1000));

    expect(moderate).not.toHaveBeenCalled();
    expect(status()).toBeNull();
  });

  it("hides an old verdict as soon as the text changes", async () => {
    vi.spyOn(campaignApi, "moderateText").mockResolvedValue("APPROVED");
    renderCampaign(<CreatePage />, LOGGED_IN);
    const field = await textField();
    await userEvent.type(field, "Aanya");
    await screen.findByText(/looks good/i, {}, { timeout: 3000 });

    await userEvent.type(field, "!");

    expect(screen.queryByText(/looks good/i)).not.toBeInTheDocument();
  });

  it("reuses a verdict for text it has already checked", async () => {
    const moderate = vi.spyOn(campaignApi, "moderateText").mockResolvedValue("APPROVED");
    renderCampaign(<CreatePage />, LOGGED_IN);
    const field = await textField();
    await userEvent.type(field, "Aanya");
    await screen.findByText(/looks good/i, {}, { timeout: 3000 });
    await userEvent.type(field, "!");
    await userEvent.type(field, "{Backspace}");

    expect(await screen.findByText(/looks good/i, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(moderate.mock.calls.filter(([t]) => t === "Aanya")).toHaveLength(1);
  });

  it("does not check text that was already approved earlier in the journey", async () => {
    const moderate = vi.spyOn(campaignApi, "moderateText");
    renderCampaign(<CreatePage />, { ...LOGGED_IN, text: "Aanya", approvedText: "Aanya" });
    await new Promise((r) => setTimeout(r, 1000));

    expect(moderate).not.toHaveBeenCalled();
    expect(screen.getByText(/looks good/i)).toBeInTheDocument();
  });

  it("stays quiet when the checker is down, and submitting still retries it", async () => {
    const moderate = vi
      .spyOn(campaignApi, "moderateText")
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValue("APPROVED");
    renderCampaign(<CreatePage />, LOGGED_IN);
    await userEvent.type(await textField(), "Aanya");
    await waitFor(() => expect(moderate).toHaveBeenCalledTimes(1), { timeout: 3000 });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/looks good/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Check my vibe" }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/user-campaign/preview"));
    expect(moderate).toHaveBeenCalledTimes(2);
  });

  it("sends an expired session back to log in when the live check is refused", async () => {
    vi.spyOn(campaignApi, "moderateText").mockRejectedValue(new CampaignError("UNAUTHORIZED", "expired"));
    renderCampaign(<CreatePage />, { ...LOGGED_IN, designId: "DISCO_BALL" });
    await userEvent.type(await textField(), "Aanya");

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/user-campaign?login=1"), { timeout: 3000 });
    expect(savedJourney()).toMatchObject({ session: null, text: "Aanya", designId: "DISCO_BALL" });
  });
});

describe("web layout (1024px and up, Figma 356:1111)", () => {
  it("filters the designs with category chips, starting on All", async () => {
    renderCampaign(<CreatePage />, LOGGED_IN);
    const chips = await screen.findByRole("group", { name: "Design categories" });
    expect(chips).toHaveClass("hidden", "lg:flex");
    const all = screen.getByRole("button", { name: "All" });
    expect(all).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("radio")).toHaveLength(9);

    await userEvent.click(screen.getByRole("button", { name: "Travel" }));
    expect(screen.getByRole("button", { name: "Travel" })).toHaveAttribute("aria-pressed", "true");
    expect(all).toHaveAttribute("aria-pressed", "false");
    const visible = screen.getAllByRole("radio").filter((r) => !r.classList.contains("lg:hidden"));
    expect(visible.map((r) => r.getAttribute("aria-label"))).toEqual(["Surfing polar bear", "Polar bear chill", "Beach vibes"]);
  });

  it("wraps the chips onto a second row on a narrow desktop instead of hiding the last ones", async () => {
    renderCampaign(<CreatePage />, LOGGED_IN);
    const chips = await screen.findByRole("group", { name: "Design categories" });
    expect(chips).toHaveClass("flex-wrap");
    expect(chips).not.toHaveClass("overflow-x-auto");
  });

  it("offers every category Figma shows, once each", async () => {
    renderCampaign(<CreatePage />, LOGGED_IN);
    const chips = await screen.findByRole("group", { name: "Design categories" });
    expect([...chips.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["All", "Fun", "Travel", "Love", "Celebration"]);
  });

  it("hides other categories on web only, so the phone layout always shows every design", async () => {
    renderCampaign(<CreatePage />, { ...LOGGED_IN, designId: "DISCO_BALL" });
    await userEvent.click(await screen.findByRole("button", { name: "Love" }));
    // Still in the page (and on the can) below 1024px, where there are no chips to undo the filter.
    const disco = screen.getByRole("radio", { name: "Disco ball" });
    expect(disco).toHaveClass("lg:hidden");
    expect(screen.getByRole("radio", { name: "Polar bears heart" })).not.toHaveClass("lg:hidden");
  });

  it("keeps the arrow button out of the text field's label, so the field's name stays 'Enter Text'", async () => {
    renderCampaign(<CreatePage />, LOGGED_IN);
    expect(await textField()).toHaveAccessibleName("Enter Text");
  });

  it("checks the text from the arrow in the web text card, like Check my vibe", async () => {
    vi.spyOn(campaignApi, "moderateText").mockResolvedValue("APPROVED");
    renderCampaign(<CreatePage />, LOGGED_IN);
    await userEvent.type(await textField(), "Aanya");
    const arrow = screen.getByRole("button", { name: "Check my text" });
    expect(arrow).toHaveClass("hidden", "lg:flex");
    await userEvent.click(arrow);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/user-campaign/preview"));
  });

  it("shows the web character count under the card", async () => {
    renderCampaign(<CreatePage />, LOGGED_IN);
    await userEvent.type(await textField(), "Aanya");
    expect(screen.getByText("Max character allowed 5/12")).toHaveClass("hidden", "lg:block");
  });

  it("splits into Figma's left panel (can and text) and right panel (vibes)", async () => {
    const { container } = renderCampaign(<CreatePage />, LOGGED_IN);
    await textField();
    expect(container.querySelector("[data-web-panel]")).toHaveClass("hidden", "lg:block", "w-[53.33%]");
    expect(container.querySelector("[data-vibes]")).toHaveClass("lg:absolute", "lg:left-[calc(53.33%+80px)]", "lg:right-20");
    expect(screen.getByText("Pick your vibe")).toHaveClass("lg:text-[32px]", "lg:leading-[38.4px]");
    expect(screen.getByRole("button", { name: "Check my vibe" })).toHaveClass("lg:mx-auto", "lg:w-[280px]");
    for (const card of screen.getAllByRole("radio")) expect(card).toHaveClass("lg:h-[140px]");
  });
});

describe("web popups (Figma 356:1183, 356:1233)", () => {
  it("spaces the heads-up as the web design does", async () => {
    renderCampaign(<CreatePage />, { session: SESSION });
    const dialog = await screen.findByRole("dialog", { name: "Quick Heads-Up!" });
    // Important, to beat the phone popup's !pt-6.
    expect(dialog).toHaveClass("lg:!py-8");
    expect(dialog.firstElementChild?.nextElementSibling ?? dialog.querySelector("div")).toHaveClass("lg:gap-4");
    expect(screen.getByRole("button", { name: "Let’s Do This" })).toHaveClass("lg:mx-auto", "lg:w-[280px]");
  });

  it("spaces the friendly-content popup as the web design does", async () => {
    renderCampaign(<CreatePage />, { ...LOGGED_IN, textRejected: true });
    const dialog = await screen.findByRole("dialog", { name: "Let’s keep it friendly" });
    expect(dialog).toHaveClass("lg:pt-[54px]", "lg:pb-6");
    expect(screen.getByText(/didn’t make the cut/).parentElement).toHaveClass("lg:gap-4");
    expect(screen.getByRole("button", { name: "Edit Text" })).toHaveClass("lg:mx-auto", "lg:w-[280px]");
  });
});
