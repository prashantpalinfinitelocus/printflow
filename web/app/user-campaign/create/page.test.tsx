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
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/?login=1"));
  });
});

describe("heads-up popup", () => {
  it("explains the entry window and the draw on the first visit", async () => {
    renderCampaign(<CreatePage />, { session: SESSION });
    const dialog = await screen.findByRole("dialog", { name: "Quick Heads-Up!" });
    expect(dialog).toHaveTextContent("Your main-character moment starts at 10AM and ends at 10PM")
    expect(dialog).not.toHaveTextContent("IST");
    expect(dialog).toHaveTextContent(/not every entry makes the cut/i);
    expect(dialog).toHaveTextContent("If you win, you’ll receive an email soon.");
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

describe("designs an admin added", () => {
  afterEach(() => vi.restoreAllMocks());

  it("leaves out a built-in design an admin hid", async () => {
    vi.spyOn(campaignApi, "listDesigns").mockResolvedValue({ added: [], hidden: ["DISCO_BALL"] });
    renderCampaign(<CreatePage />, LOGGED_IN);

    await waitFor(() => expect(screen.getAllByRole("radio")).toHaveLength(8));
    expect(screen.queryByRole("radio", { name: "Disco ball" })).not.toBeInTheDocument();
  });

  it("shows them after the built-in designs, with their sticker, in their category", async () => {
    vi.spyOn(campaignApi, "listDesigns").mockResolvedValue({
      added: [{ designId: "SUMMER_SPLASH", name: "Summer splash", category: "Travel", version: 4 }],
      hidden: [],
    });
    renderCampaign(<CreatePage />, LOGGED_IN);

    const summer = await screen.findByRole("radio", { name: "Summer splash" });
    expect(screen.getAllByRole("radio").at(-1)).toBe(summer);
    expect(summer.querySelector("img")).toHaveAttribute("src", "/offline-store/api/campaign/designs/SUMMER_SPLASH/sticker?v=4");

    await userEvent.click(summer);
    expect(summer).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("button", { name: "Fun" }));
    expect(summer).toHaveClass("lg:hidden");
    await userEvent.click(screen.getByRole("button", { name: "Travel" }));
    expect(summer).not.toHaveClass("lg:hidden");
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
  it("keeps the text card and a two-line status message on screen, with the can shrinking rather than overlapping it", async () => {
    const { container } = renderCampaign(<CreatePage />, LOGGED_IN);
    const card = (await textField()).closest("label")!.parentElement!.parentElement!;
    // Card, counter and the two-line rejection message take about 149px of the 161px Figma leaves under the card.
    expect(card).toHaveClass("lg:top-[min(82.11dvh,calc(100dvh-161px))]");
    const can = container.querySelector('[role="img"]')!.parentElement!;
    expect(can).toHaveClass("lg:top-[8.39dvh]", "lg:h-[min(68.78dvh,calc(91.61dvh-205.5px))]");
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
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/?login=1"));
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

  it("keeps flagged text off the can, so it can't be screenshotted on the product", async () => {
    vi.spyOn(campaignApi, "moderateText").mockResolvedValue("REJECTED");
    renderCampaign(<CreatePage />, LOGGED_IN);
    await userEvent.type(await textField(), "stupid");

    await screen.findByText(FRIENDLY, {}, { timeout: 3000 });
    expect(screen.getByRole("img", { name: /^Diet Coke can/ })).not.toHaveAccessibleName(/stupid/i);
    expect(screen.queryByText("STUPID")).not.toBeInTheDocument();
  });

  it("keeps text the server turned down off the can when coming back from the preview", async () => {
    renderCampaign(<CreatePage />, { ...LOGGED_IN, text: "stupid", textRejected: true });
    await screen.findByRole("dialog", { name: "Let’s keep it friendly" });
    expect(screen.queryByText("STUPID")).not.toBeInTheDocument();
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

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/?login=1"), { timeout: 3000 });
    expect(savedJourney()).toMatchObject({ session: null, text: "Aanya", designId: "DISCO_BALL" });
  });
});

describe("web layout (1024px and up, Figma 518:6902)", () => {
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

  it("sets the web placeholder at 16px so it fits beside the arrow instead of being cut off", async () => {
    renderCampaign(<CreatePage />, LOGGED_IN);
    expect(await textField()).toHaveClass("lg:text-2xl", "lg:placeholder:text-base");
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
    expect(screen.getByText("Max characters allowed 5/12")).toHaveClass("hidden", "lg:block");
  });

  it("splits into Figma's left panel (can and text) and right panel (vibes)", async () => {
    const { container } = renderCampaign(<CreatePage />, LOGGED_IN);
    await textField();
    expect(container.querySelector("[data-web-panel]")).toHaveClass("hidden", "lg:block", "w-[53.33%]");
    expect(container.querySelector("[data-vibes]")).toHaveClass("lg:absolute", "lg:left-[calc(53.33%+80px)]", "lg:right-20");
    expect(screen.getByText("Pick your vibe")).toHaveClass("lg:font-[family-name:var(--dc-serif)]", "lg:text-[32px]", "lg:leading-11");
    expect(screen.getByRole("button", { name: "Check my vibe" })).toHaveClass("lg:mx-auto", "lg:h-14", "lg:w-[280px]");
    for (const card of screen.getAllByRole("radio")) expect(card).toHaveClass("lg:h-[140px]");
  });
});

describe("web popups (Figma 518:7053, 518:7066)", () => {
  it("makes the heads-up Figma's narrower card with a full-width button", async () => {
    renderCampaign(<CreatePage />, { session: SESSION });
    const dialog = await screen.findByRole("dialog", { name: "Quick Heads-Up!" });
    expect(dialog).toHaveClass("max-w-[334px]", "lg:w-[372px]", "lg:max-w-[372px]");
    // Important, to beat the phone popup's !pt-6.
    expect(dialog.firstElementChild).toHaveClass("!pt-6", "lg:!p-8");
    expect(screen.getByRole("button", { name: "Let’s Do This" })).toHaveClass("lg:h-14");
    expect(screen.getByRole("heading", { name: "Quick Heads-Up!" })).toHaveClass("lg:text-[28px]", "lg:leading-[38px]");
  });

  it("spaces the friendly-content popup as the web design does", async () => {
    renderCampaign(<CreatePage />, { ...LOGGED_IN, textRejected: true });
    const dialog = await screen.findByRole("dialog", { name: "Let’s keep it friendly" });
    expect(dialog.firstElementChild).toHaveClass("!pt-6", "lg:!pt-8");
    expect(screen.getByText(/didn’t make the cut/).parentElement).toHaveClass("lg:gap-[5px]");
    expect(screen.getByRole("button", { name: "Edit Text" })).toHaveClass("lg:mx-auto", "lg:w-[280px]");
  });
});
