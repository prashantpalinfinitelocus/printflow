import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CampaignError, CampaignServerError, campaignApi } from "@/lib/campaign/api";
import { renderCanPng } from "@/lib/campaign/canImage";
import { SESSION, gaEventNames, gaEvents, renderCampaign, savedJourney } from "@/test/campaign";
import { router } from "@/test/navigation";

import PreviewPage from "./page";

/* jsdom has no canvas; the drawing itself is covered in canImage.test.ts. */
vi.mock("@/lib/campaign/canImage", async (original) => ({
  ...(await original<typeof import("@/lib/campaign/canImage")>()),
  renderCanPng: vi.fn(async () => new Blob(["png"], { type: "image/png" })),
}));

const APPROVED = { session: SESSION, designId: "DISCO_BALL", text: "Aanya", approvedText: "Aanya" };
/** IST is UTC+05:30. */
const ist = (hh: number, mm = 0) => new Date(Date.UTC(2026, 9, 30, hh - 5, mm - 30));

beforeEach(() => {
  // Only the clock is faked, so the entry window is deterministic but the mock's latency still runs.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(ist(12));
  URL.createObjectURL = vi.fn(() => "blob:can");
  URL.revokeObjectURL = vi.fn();
  // jsdom cannot follow a download link; record the click instead.
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.mocked(renderCanPng).mockClear();
  // Object.assign(navigator, …) below is not undone by restoreAllMocks.
  delete (navigator as { share?: unknown }).share;
  delete (navigator as { canShare?: unknown }).canShare;
});

/** The file name of the last download link the page clicked. */
const downloadedAs = () =>
  (vi.mocked(HTMLAnchorElement.prototype.click).mock.contexts.at(-1) as HTMLAnchorElement | undefined)?.download;

const makeItHappen = () => screen.findByRole("button", { name: "Make it happen" });

/** Download/share are enabled once the can PNG has been rendered. */
async function imageReady(name: "Download My Can" | "Share My Look") {
  const button = await screen.findByRole("button", { name });
  await waitFor(() => expect(button).toBeEnabled());
  return button;
}

describe("access", () => {
  it("sends a visitor without a session back to log in", async () => {
    renderCampaign(<PreviewPage />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/?login=1"));
  });

  it("sends text that moderation has not approved back to the customiser", async () => {
    renderCampaign(<PreviewPage />, { ...APPROVED, text: "Aanya!" });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/user-campaign/create"));
  });
});

describe("while loading", () => {
  it("shows the photo backdrop, not a blank page, when the text has not been approved", async () => {
    const { container } = renderCampaign(<PreviewPage />, { ...APPROVED, text: "Aanya!" });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/user-campaign/create"));
    expect(container.querySelector("[data-web-panel]")).toBeInTheDocument();
  });
});

describe("tablet layout (481px to 1023px)", () => {
  it("keeps the buttons and copy in a centred phone-width column", async () => {
    const { container } = renderCampaign(<PreviewPage />, APPROVED);
    await screen.findByRole("button", { name: "Make it happen" });
    expect(container.querySelector("main")).toHaveClass("px-[max(20px,calc(50%-220px))]", "lg:px-5");
    expect(screen.getByRole("button", { name: "Make it happen" }).parentElement).toHaveClass("inset-x-[max(20px,calc(50%-220px))]");
  });
});

describe("image quality", () => {
  it("serves the can and logo at full quality", async () => {
    const { container } = renderCampaign(<PreviewPage />, APPROVED);
    await screen.findByRole("button", { name: "Make it happen" });
    for (const img of container.querySelectorAll("img:not([src^='blob:'])")) expect(img.getAttribute("src")).toMatch(/\?q=100$/);
  });
});

describe("web layout (1024px and up, Figma 518:6976)", () => {
  it("puts the can on a photo left panel with the round buttons stacked beside it", async () => {
    const { container } = renderCampaign(<PreviewPage />, APPROVED);
    await screen.findByRole("button", { name: "Make it happen" });
    expect(container.querySelector("[data-web-panel]")).toHaveClass("hidden", "lg:block", "w-[53.33%]");
    const actions = container.querySelector("[data-actions]");
    expect(actions).toHaveClass("lg:absolute", "lg:top-[130px]", "lg:left-10", "lg:flex-col-reverse", "lg:gap-4");
    // Back is an addition to Figma, agreed for editing: first in the tab order, shown after download and share on web.
    expect([...actions!.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual([
      "Back to editing",
      "Download My Can",
      "Share My Look",
    ]);
    for (const b of actions!.querySelectorAll("button")) expect(b).toHaveClass("lg:h-12", "lg:w-12", "lg:border-0");
  });

  it("centres the headline, copy and button in the right part", async () => {
    const { container } = renderCampaign(<PreviewPage />, APPROVED);
    await screen.findByRole("button", { name: "Make it happen" });
    expect(container.querySelector("[data-copy]")).toHaveClass("lg:absolute", "lg:left-[76.67%]", "lg:top-1/2", "lg:w-[454px]", "lg:gap-14");
    expect(screen.getByRole("heading", { name: "It’s giving iconic!" })).toHaveClass("lg:text-[56px]", "lg:leading-[84px]");
    expect(screen.getByRole("button", { name: "Make it happen" })).toHaveClass("lg:mx-auto", "lg:h-14", "lg:w-[280px]");
  });
});

describe("preview", () => {
  it("keeps the headline and message above the background photo", async () => {
    renderCampaign(<PreviewPage />, APPROVED);
    const heading = await screen.findByRole("heading", { name: "It’s giving iconic!" });
    expect(heading.parentElement).toHaveClass("relative");
  });

  it("shows the approved can under the Figma headline", async () => {
    renderCampaign(<PreviewPage />, APPROVED);
    expect(await screen.findByRole("heading", { name: "It’s giving iconic!" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /disco ball.*aanya/i })).toBeInTheDocument();
  });

  it("swaps in the exported PNG once ready, so a long-press saves the personalised can", async () => {
    renderCampaign(<PreviewPage />, APPROVED);
    const image = await screen.findByRole("img", { name: /your personalised diet coke can.*disco ball.*aanya/i });
    expect(image).toHaveAttribute("src", "blob:can");
    expect(renderCanPng).toHaveBeenCalledWith("DISCO_BALL", "Aanya", "can");
  });

  it("goes back to editing", async () => {
    renderCampaign(<PreviewPage />, APPROVED);
    await userEvent.click(await screen.findByRole("button", { name: "Back to editing" }));
    expect(router.push).toHaveBeenCalledWith("/user-campaign/create");
  });
});

describe("entry", () => {
  it("submits the design and text, then shows the thank-you page", async () => {
    const submit = vi.spyOn(campaignApi, "submitEntry");
    renderCampaign(<PreviewPage />, APPROVED);
    await userEvent.click(await makeItHappen());
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/user-campaign/success"), { timeout: 2000 });
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ designId: "DISCO_BALL", text: "Aanya", idempotencyKey: expect.any(String) }),
    );
    await waitFor(() => expect(savedJourney().pendingEntry).toBeNull());
  });

  it("retries a failed submission with the same idempotency key, so it cannot double-enter", async () => {
    const submit = vi.spyOn(campaignApi, "submitEntry").mockRejectedValueOnce(new Error("network"));
    renderCampaign(<PreviewPage />, APPROVED);
    await userEvent.click(await makeItHappen());
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t submit your entry/i);
    await userEvent.click(await makeItHappen());
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    const [first, second] = submit.mock.calls.map(([entry]) => entry.idempotencyKey);
    expect(second).toBe(first);
  });

  it("keeps the same idempotency key after a reload, when the first response was lost", async () => {
    const submit = vi.spyOn(campaignApi, "submitEntry").mockRejectedValueOnce(new Error("response lost"));
    const first = renderCampaign(<PreviewPage />, APPROVED);
    await userEvent.click(await makeItHappen());
    await screen.findByRole("alert");
    first.unmount();

    renderCampaign(<PreviewPage />, savedJourney());
    await userEvent.click(await makeItHappen());
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    const [a, b] = submit.mock.calls.map(([entry]) => entry.idempotencyKey);
    expect(b).toBe(a);
  });

  it("uses a fresh key once the text differs from the unfinished entry", async () => {
    const submit = vi.spyOn(campaignApi, "submitEntry");
    renderCampaign(<PreviewPage />, {
      ...APPROVED,
      pendingEntry: { key: "old-key", designId: "DISCO_BALL", text: "Riya" },
    });
    await userEvent.click(await makeItHappen());
    await waitFor(() => expect(submit).toHaveBeenCalled());
    expect(submit.mock.calls[0][0].idempotencyKey).not.toBe("old-key");
  });

  it("switches to the closed screen when the window closes while the user is on this screen", async () => {
    renderCampaign(<PreviewPage />, APPROVED);
    const button = await makeItHappen();
    await waitFor(() => expect(button).toBeEnabled());
    vi.setSystemTime(ist(22, 0));
    await userEvent.click(button);
    expect(await screen.findByRole("heading", { level: 1, name: /Wrong time!/ }, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("does not leave the button spinning when the window re-check itself fails", async () => {
    vi.spyOn(campaignApi, "submitEntry").mockRejectedValueOnce(new CampaignError("WINDOW_CLOSED", "Closed now."));
    vi.spyOn(campaignApi, "getWindowState").mockResolvedValueOnce("OPEN").mockRejectedValueOnce(new Error("offline"));
    renderCampaign(<PreviewPage />, APPROVED);
    await userEvent.click(await makeItHappen());
    expect(await screen.findByRole("alert")).toHaveTextContent("Closed now.");
    expect(screen.getByRole("button", { name: "Make it happen" })).not.toHaveAttribute("aria-busy");
  });

  it("sends a text the server rejects at submit back to editing, with the friendly-content popup", async () => {
    vi.spyOn(campaignApi, "submitEntry").mockRejectedValueOnce(new CampaignError("TEXT_REJECTED", "Not the vibe."));
    renderCampaign(<PreviewPage />, APPROVED);
    await userEvent.click(await makeItHappen());
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/user-campaign/create"));
    expect(savedJourney()).toMatchObject({ approvedText: null, textRejected: true, text: "Aanya" });
  });

  it("shows the server's reason when an entry cannot be submitted", async () => {
    vi.spyOn(campaignApi, "submitEntry").mockRejectedValueOnce(
      new CampaignServerError("Our message checker needs a moment. Your design is still here — please try again."),
    );
    renderCampaign(<PreviewPage />, APPROVED);
    await userEvent.click(await makeItHappen());
    expect(await screen.findByRole("alert")).toHaveTextContent("Our message checker needs a moment.");
  });

  it("sends an expired session back to log in, keeping the approved can", async () => {
    vi.spyOn(campaignApi, "submitEntry").mockRejectedValueOnce(new CampaignError("UNAUTHORIZED", "expired"));
    renderCampaign(<PreviewPage />, APPROVED);
    await userEvent.click(await makeItHappen());
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/?login=1"));
    expect(savedJourney()).toMatchObject({ session: null, text: "Aanya", approvedText: "Aanya" });
  });
});

describe("outside the entry window (Figma 559:7847, 559:7823)", () => {
  it("swaps the headline and copy, greys the button out and notes the hours", async () => {
    vi.setSystemTime(ist(22, 30));
    renderCampaign(<PreviewPage />, APPROVED);
    const heading = await screen.findByRole("heading", { level: 1, name: /^Right vibe, Wrong time!/ });
    expect(heading).toBeInTheDocument();
    expect(screen.getByText("Your main-character moment starts at 10AM and ends at 10PM.")).toBeInTheDocument();
    expect(screen.getByText("Entries open from 10AM to 10PM")).toBeInTheDocument();
    expect(screen.queryByText(/It’s giving/)).not.toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Make it happen" });
    expect(button).toBeDisabled();
    expect(button).toHaveClass("!text-[#B6B9BC]", "disabled:opacity-100", "lg:bg-[#E1E6EB]");
  });

  it("places the web block 319px down rather than centring it", async () => {
    vi.setSystemTime(ist(22, 30));
    const { container } = renderCampaign(<PreviewPage />, APPROVED);
    await screen.findByRole("heading", { level: 1, name: /Wrong time!/ });
    const copy = container.querySelector("[data-copy]");
    expect(copy).toHaveClass("lg:top-[35.44%]", "lg:w-[572px]");
    expect(copy).not.toHaveClass("lg:-translate-y-1/2");
  });

  it("doesn't promise opening hours while entries are paused", async () => {
    vi.spyOn(campaignApi, "getWindowState").mockResolvedValue("PAUSED");
    renderCampaign(<PreviewPage />, APPROVED);
    await screen.findByRole("heading", { level: 1, name: /Wrong time!/ });
    expect(screen.getByText(/Entries are currently unavailable/)).toBeInTheDocument();
    expect(screen.queryByText("Entries open from 10AM to 10PM")).not.toBeInTheDocument();
  });
});

describe("download and share", () => {
  it("downloads the can without creating an entry", async () => {
    const submit = vi.spyOn(campaignApi, "submitEntry");
    renderCampaign(<PreviewPage />, APPROVED);
    await userEvent.click(await imageReady("Download My Can"));
    expect(downloadedAs()).toBe("my-diet-coke-can.png");
    expect(submit).not.toHaveBeenCalled();
  });

  it("confirms a download by turning the icon into a tick for 2 seconds, with no message", async () => {
    renderCampaign(<PreviewPage />, APPROVED);
    const download = await imageReady("Download My Can");
    // beforeEach only fakes the clock; reinstall so the 2-second timer can be stepped too.
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    fireEvent.click(download);
    expect(screen.getByRole("button", { name: "Downloaded" })).toBe(download);
    expect(download.querySelector("[data-icon='tick']")).toHaveClass("animate-pop");
    expect(screen.queryByText(/saved/i)).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1999));
    expect(download).toHaveAccessibleName("Downloaded");
    act(() => vi.advanceTimersByTime(1));
    expect(download).toHaveAccessibleName("Download My Can");
    expect(download.querySelector("[data-icon='download']")).not.toBeNull();
  });

  it("restarts the 2 seconds when the can is downloaded again", async () => {
    renderCampaign(<PreviewPage />, APPROVED);
    const download = await imageReady("Download My Can");
    // beforeEach only fakes the clock; reinstall so the 2-second timer can be stepped too.
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    fireEvent.click(download);
    act(() => vi.advanceTimersByTime(1500));
    fireEvent.click(download);
    act(() => vi.advanceTimersByTime(1500));
    expect(download).toHaveAccessibleName("Downloaded");
    act(() => vi.advanceTimersByTime(500));
    expect(download).toHaveAccessibleName("Download My Can");
  });

  it("renders the PNG once per visit, not on every tap", async () => {
    renderCampaign(<PreviewPage />, APPROVED);
    const download = await imageReady("Download My Can");
    await userEvent.click(download);
    await userEvent.click(download);
    expect(renderCanPng).toHaveBeenCalledOnce();
  });

  it("calls share inside the tap itself, as iOS Safari requires", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { share, canShare: () => true });
    renderCampaign(<PreviewPage />, APPROVED);
    fireEvent.click(await imageReady("Share My Look"));
    // Synchronous: no await between the tap and share().
    expect(share).toHaveBeenCalledOnce();
    expect(share.mock.calls[0][0].files[0]).toMatchObject({ name: "my-diet-coke-can.png", type: "image/png" });
  });

  it("saves the image instead where sharing files is not supported", async () => {
    Object.assign(navigator, { share: vi.fn(), canShare: () => false });
    renderCampaign(<PreviewPage />, APPROVED);
    await userEvent.click(await imageReady("Share My Look"));
    expect(await screen.findByText(/sharing isn’t supported here, so we saved it/i)).toBeInTheDocument();
    expect(navigator.share).not.toHaveBeenCalled();
    expect(downloadedAs()).toBe("my-diet-coke-can.png");
  });

  it("offers a screenshot, and no false save, when the image cannot be made", async () => {
    vi.mocked(renderCanPng).mockRejectedValueOnce(new Error("canvas"));
    renderCampaign(<PreviewPage />, APPROVED);
    expect(await screen.findByText(/take a screenshot/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download My Can" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Share My Look" })).toBeDisabled();
    expect(screen.queryByText(/long-press/i)).not.toBeInTheDocument();
  });

  it("treats closing the share sheet as a choice, not an error", async () => {
    const share = vi.fn().mockRejectedValue(new DOMException("cancelled", "AbortError"));
    Object.assign(navigator, { share, canShare: () => true });
    renderCampaign(<PreviewPage />, APPROVED);
    await userEvent.click(await imageReady("Share My Look"));
    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(screen.queryByText(/couldn.t open sharing/i)).not.toBeInTheDocument();
  });
});

describe("analytics", () => {
  it("counts one preview view", async () => {
    renderCampaign(<PreviewPage />, APPROVED);
    await imageReady("Download My Can");
    expect(gaEventNames()).toEqual(["preview_viewed"]);
  });

  it("does not count a preview for a visitor being sent away", async () => {
    renderCampaign(<PreviewPage />, { session: SESSION, text: "Aanya", approvedText: null });
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(gaEventNames()).toEqual([]);
  });

  it("counts the click back to editing", async () => {
    renderCampaign(<PreviewPage />, APPROVED);
    await userEvent.click(await screen.findByRole("button", { name: "Back to editing" }));
    expect(gaEventNames()).toContain("preview_edit_clicked");
  });

  it("counts a download's click and its outcome", async () => {
    renderCampaign(<PreviewPage />, APPROVED);
    await userEvent.click(await imageReady("Download My Can"));
    expect(gaEventNames()).toContain("download_initiated");
    expect(gaEvents()).toContainEqual({ name: "file_download", download_outcome: "success" });
  });

  it("counts a share when the sheet opens", async () => {
    Object.assign(navigator, { share: vi.fn().mockResolvedValue(undefined), canShare: () => true });
    renderCampaign(<PreviewPage />, APPROVED);
    await userEvent.click(await imageReady("Share My Look"));
    await waitFor(() => expect(gaEventNames()).toContain("share"));
  });

  it("counts a share sheet the visitor closed, since it did open", async () => {
    Object.assign(navigator, { share: vi.fn().mockRejectedValue(new DOMException("cancelled", "AbortError")), canShare: () => true });
    renderCampaign(<PreviewPage />, APPROVED);
    await userEvent.click(await imageReady("Share My Look"));
    await waitFor(() => expect(gaEventNames()).toContain("share"));
  });

  it("does not count a share sheet that failed to open", async () => {
    Object.assign(navigator, { share: vi.fn().mockRejectedValue(new Error("nope")), canShare: () => true });
    renderCampaign(<PreviewPage />, APPROVED);
    await userEvent.click(await imageReady("Share My Look"));
    await screen.findByText(/couldn’t open sharing/i);
    expect(gaEventNames()).not.toContain("share");
  });

  it("counts the fallback save as a download, not a share", async () => {
    Object.assign(navigator, { share: vi.fn(), canShare: () => false });
    renderCampaign(<PreviewPage />, APPROVED);
    await userEvent.click(await imageReady("Share My Look"));
    expect(gaEventNames()).not.toContain("share");
    expect(gaEvents()).toContainEqual({ name: "file_download", download_outcome: "success" });
  });

  it("counts an attempt and an accepted entry", async () => {
    renderCampaign(<PreviewPage />, APPROVED);
    await userEvent.click(await makeItHappen());
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/user-campaign/success"));
    expect(gaEventNames()).toEqual(["preview_viewed", "entry_submission_attempted", "entry_submitted"]);
  });

  it("reports a failed entry by reason, not by message", async () => {
    vi.spyOn(campaignApi, "submitEntry").mockRejectedValue(new CampaignError("ENTRY_LIMIT_REACHED", "That's all for today."));
    renderCampaign(<PreviewPage />, APPROVED);
    await userEvent.click(await makeItHappen());
    await screen.findByText("That's all for today.");
    expect(gaEvents()).toContainEqual({ name: "entry_submission_failed", failure_reason: "entry_limit_reached" });
    expect(gaEventNames()).not.toContain("entry_submitted");
  });

  it("counts a closed window as a block, not a failure", async () => {
    vi.spyOn(campaignApi, "submitEntry").mockRejectedValue(new CampaignError("WINDOW_CLOSED", "Closed for today."));
    renderCampaign(<PreviewPage />, APPROVED);
    await userEvent.click(await makeItHappen());
    await screen.findByText("Closed for today.");
    expect(gaEventNames()).toContain("entry_window_blocked");
    expect(gaEventNames()).not.toContain("entry_submission_failed");
  });

  it("counts a retry of the same entry as the same attempt", async () => {
    vi.spyOn(campaignApi, "submitEntry").mockRejectedValueOnce(new Error("lost"));
    renderCampaign(<PreviewPage />, APPROVED);
    await userEvent.click(await makeItHappen());
    await screen.findByText(/couldn’t submit your entry/i);
    await userEvent.click(await makeItHappen());
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/user-campaign/success"));
    expect(gaEventNames().filter((n) => n === "entry_submission_attempted")).toHaveLength(1);
    expect(gaEventNames().filter((n) => n === "entry_submission_failed")).toHaveLength(1);
    expect(gaEventNames().filter((n) => n === "entry_submitted")).toHaveLength(1);
  });
});
