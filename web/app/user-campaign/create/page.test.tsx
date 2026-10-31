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
