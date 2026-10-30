import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { campaignApi } from "@/lib/campaign/api";
import { renderCanPng } from "@/lib/campaign/canImage";
import { SESSION, renderCampaign } from "@/test/campaign";
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

/** The file name of the last download link the page clicked. */
const downloadedAs = () =>
  (vi.mocked(HTMLAnchorElement.prototype.click).mock.contexts.at(-1) as HTMLAnchorElement | undefined)?.download;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.mocked(renderCanPng).mockClear();
});

const makeItHappen = () => screen.findByRole("button", { name: "Make It Happen" });

describe("access", () => {
  it("sends a visitor without a session back to log in", async () => {
    renderCampaign(<PreviewPage />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/campaign?login=1"));
  });

  it("sends text that moderation has not approved back to the customiser", async () => {
    renderCampaign(<PreviewPage />, { ...APPROVED, text: "Aanya!" });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/campaign/create"));
  });
});

describe("preview", () => {
  it("shows the approved can under the Figma headline", async () => {
    renderCampaign(<PreviewPage />, APPROVED);
    expect(await screen.findByRole("heading", { name: "It’s giving iconic!" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /disco ball.*aanya/i })).toBeInTheDocument();
  });

  it("goes back to editing", async () => {
    renderCampaign(<PreviewPage />, APPROVED);
    await userEvent.click(await screen.findByRole("button", { name: "Back to editing" }));
    expect(router.push).toHaveBeenCalledWith("/campaign/create");
  });
});

describe("entry", () => {
  it("submits the design and text, then shows the thank-you page", async () => {
    const submit = vi.spyOn(campaignApi, "submitEntry");
    renderCampaign(<PreviewPage />, APPROVED);
    await userEvent.click(await makeItHappen());
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/campaign/success"), { timeout: 2000 });
    expect(submit).toHaveBeenCalledWith(
      SESSION.token,
      expect.objectContaining({ designId: "DISCO_BALL", text: "Aanya", idempotencyKey: expect.any(String) }),
    );
  });

  it("retries a failed submission with the same idempotency key, so it cannot double-enter", async () => {
    const submit = vi.spyOn(campaignApi, "submitEntry").mockRejectedValueOnce(new Error("network"));
    renderCampaign(<PreviewPage />, APPROVED);
    await userEvent.click(await makeItHappen());
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t submit your entry/i);
    await userEvent.click(await makeItHappen());
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    const [first, second] = submit.mock.calls.map(([, entry]) => entry.idempotencyKey);
    expect(second).toBe(first);
  });

  it("explains the closed window and disables entry after 10 PM IST", async () => {
    vi.setSystemTime(ist(22, 30));
    renderCampaign(<PreviewPage />, APPROVED);
    expect(await screen.findByText(/today’s entry window is closed/i)).toBeInTheDocument();
    expect(await makeItHappen()).toBeDisabled();
  });

  it("explains the window when it closes while the user is on this screen", async () => {
    renderCampaign(<PreviewPage />, APPROVED);
    const button = await makeItHappen();
    await waitFor(() => expect(button).toBeEnabled());
    vi.setSystemTime(ist(22, 0));
    await userEvent.click(button);
    expect(await screen.findByRole("alert", {}, { timeout: 2000 })).toHaveTextContent(/today’s entry window is closed/i);
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe("download and share", () => {
  it("downloads the can without creating an entry", async () => {
    const submit = vi.spyOn(campaignApi, "submitEntry");
    renderCampaign(<PreviewPage />, APPROVED);
    await userEvent.click(await screen.findByRole("button", { name: "Download My Can" }));
    expect(await screen.findByText(/saved! check your downloads/i)).toBeInTheDocument();
    expect(renderCanPng).toHaveBeenCalledWith("DISCO_BALL", "Aanya", "can");
    expect(downloadedAs()).toBe("my-diet-coke-can.png");
    expect(submit).not.toHaveBeenCalled();
  });

  it("explains a fallback when the image cannot be made", async () => {
    vi.mocked(renderCanPng).mockRejectedValueOnce(new Error("canvas"));
    renderCampaign(<PreviewPage />, APPROVED);
    await userEvent.click(await screen.findByRole("button", { name: "Download My Can" }));
    expect(await screen.findByText(/long-press the can/i)).toBeInTheDocument();
  });

  it("opens the native share sheet with the can image", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { share, canShare: () => true });
    renderCampaign(<PreviewPage />, APPROVED);
    await userEvent.click(await screen.findByRole("button", { name: "Share My Look" }));
    await waitFor(() => expect(share).toHaveBeenCalledOnce());
    const [{ files }] = share.mock.calls[0];
    expect(files[0]).toMatchObject({ name: "my-diet-coke-can.png", type: "image/png" });
  });

  it("saves the image instead where sharing files is not supported", async () => {
    Object.assign(navigator, { share: vi.fn(), canShare: () => false });
    renderCampaign(<PreviewPage />, APPROVED);
    await userEvent.click(await screen.findByRole("button", { name: "Share My Look" }));
    expect(await screen.findByText(/sharing isn’t supported here, so we saved it/i)).toBeInTheDocument();
    expect(navigator.share).not.toHaveBeenCalled();
  });

  it("does not claim the image was saved when the share fallback fails too", async () => {
    Object.assign(navigator, { share: vi.fn(), canShare: () => false });
    vi.mocked(renderCanPng).mockRejectedValueOnce(new Error("canvas"));
    renderCampaign(<PreviewPage />, APPROVED);
    await userEvent.click(await screen.findByRole("button", { name: "Share My Look" }));
    expect(await screen.findByText(/long-press the can/i)).toBeInTheDocument();
    expect(screen.queryByText(/saved/i)).not.toBeInTheDocument();
  });

  it("treats closing the share sheet as a choice, not an error", async () => {
    const share = vi.fn().mockRejectedValue(new DOMException("cancelled", "AbortError"));
    Object.assign(navigator, { share, canShare: () => true });
    renderCampaign(<PreviewPage />, APPROVED);
    await userEvent.click(await screen.findByRole("button", { name: "Share My Look" }));
    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(screen.queryByText(/couldn.t open sharing/i)).not.toBeInTheDocument();
  });
});
