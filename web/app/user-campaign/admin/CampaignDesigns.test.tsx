import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminApiError, type CampaignDesign, type DesignFormat } from "@/lib/campaign/admin";
import { DESIGNS } from "@/lib/campaign/designs";

import { CampaignDesigns } from "./CampaignDesigns";

const api = vi.hoisted(() => ({
  adminGet: vi.fn(),
  adminPost: vi.fn(),
  adminUpload: vi.fn(),
}));
vi.mock("@/lib/campaign/admin", async (actual) => ({ ...(await actual<typeof import("@/lib/campaign/admin")>()), ...api }));

const discoBall: DesignFormat = {
  psd_path: "campaign-DISCO_BALL.psd",
  width_px: 932,
  height_px: 2304,
  dpi: 300,
  text_box: { x: 140, y: 1081, w: 652, h: 86 },
  font_size: 54,
  font_color: "#F40009",
  font_path: "You2013 Regular.ttf",
  placeholder_color: null,
};

const builtin = (id: string, over: Partial<CampaignDesign> = {}): CampaignDesign => ({
  design_id: id,
  name: null,
  category: null,
  builtin: true,
  active: true,
  version: 0,
  format: id === "DISCO_BALL" ? discoBall : null,
  ...over,
});
const summer = (over: Partial<CampaignDesign> = {}): CampaignDesign => ({
  design_id: "SUMMER_SPLASH",
  name: "Summer splash",
  category: "Travel",
  builtin: false,
  active: true,
  version: 2,
  format: null,
  ...over,
});
let list: CampaignDesign[] = [];
const designs = () => list;

const psd = (name = "beach.psd") => new File(["8BPS"], name, { type: "image/vnd.adobe.photoshop" });
const row = (name: string) => screen.getByRole("listitem", { name });

beforeEach(() => {
  list = DESIGNS.map((d) => builtin(d.id));
  api.adminGet.mockImplementation(async () => designs());
});

afterEach(() => vi.clearAllMocks());

describe("CampaignDesigns", () => {
  it("lists the nine campaign designs from the campaign admin API, and which have their PSD set up", async () => {
    render(<CampaignDesigns />);

    await screen.findByText("campaign-DISCO_BALL.psd");
    expect(api.adminGet).toHaveBeenCalledWith("/designs");
    expect(screen.getAllByRole("listitem")).toHaveLength(9);
    expect(within(row("Disco ball")).getByText("PSD ready")).toBeInTheDocument();
    expect(within(row("Disco ball")).getByText(/932 × 2304 px · 300 dpi/)).toBeInTheDocument();
    expect(within(row("Disco ball")).getByText(/You2013 Regular\.ttf/)).toBeInTheDocument();
    expect(within(row("Beach vibes")).getByText("No PSD yet")).toBeInTheDocument();
  });

  it("offers only the PSD upload on every design, built-in or added", async () => {
    list = [...list, summer()];
    render(<CampaignDesigns />);
    const added = await screen.findByRole("listitem", { name: "Summer splash" });

    expect(screen.queryByRole("form", { name: "Add a design" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Sticker image")).not.toBeInTheDocument();
    for (const design of [row("Disco ball"), row("Beach vibes"), added]) {
      expect(within(design).queryAllByRole("button")).toHaveLength(0);
      expect(within(design).getByLabelText(/^Upload PSD for /)).toBeInTheDocument();
    }
    expect(screen.queryByLabelText(/Replace sticker/)).not.toBeInTheDocument();
    expect(api.adminGet).not.toHaveBeenCalledWith("/fonts");
  });

  it("still names and pictures an added design", async () => {
    list = [...list, summer()];
    render(<CampaignDesigns />);
    const added = await screen.findByRole("listitem", { name: "Summer splash" });
    expect(within(added).getByRole("img")).toHaveAttribute("src", "/user-campaign/api/admin/catalog/SUMMER_SPLASH/sticker?v=2");
  });

  it("still marks a design that is hidden from users", async () => {
    list = list.map((d) => (d.design_id === "DISCO_BALL" ? { ...d, active: false } : d));
    render(<CampaignDesigns />);
    await screen.findByText("campaign-DISCO_BALL.psd");
    expect(within(row("Disco ball")).getByText("Hidden")).toBeInTheDocument();
  });

  it("shows a pointer on the PSD buttons", async () => {
    render(<CampaignDesigns />);
    await screen.findByText("campaign-DISCO_BALL.psd");
    expect(within(row("Beach vibes")).getByText("Upload PSD")).toHaveClass("cursor-pointer");
    expect(within(row("Disco ball")).getByText("Replace PSD")).toHaveClass("cursor-pointer");
  });

  it("uploads a design's PSD to its own endpoint; the server places the text on the can's name line", async () => {
    const onSaved = vi.fn();
    api.adminUpload.mockResolvedValue({ design_id: "BEACH_VIBES", format: { ...discoBall, psd_path: "campaign-BEACH_VIBES.psd" } });
    render(<CampaignDesigns onSaved={onSaved} />);
    await screen.findByText("campaign-DISCO_BALL.psd");

    await userEvent.upload(within(row("Beach vibes")).getByLabelText("Upload PSD for Beach vibes"), psd());

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(api.adminUpload).toHaveBeenCalledWith("/designs/BEACH_VIBES/psd", expect.any(File));
    // No colour search on upload: Diet Coke art is mostly red, and a search could take the logo for the placeholder.
    expect(api.adminPost).not.toHaveBeenCalled();
    expect(await within(row("Beach vibes")).findByText("PSD ready")).toBeInTheDocument();
    expect(within(row("Beach vibes")).getByText("campaign-BEACH_VIBES.psd")).toBeInTheDocument();
  });

  it("offers to replace the PSD of a design that is already set up", async () => {
    api.adminUpload.mockResolvedValue({ design_id: "DISCO_BALL", format: { ...discoBall, width_px: 1000 } });
    render(<CampaignDesigns />);
    await screen.findByText("campaign-DISCO_BALL.psd");

    expect(within(row("Disco ball")).getByText("Replace PSD")).toBeInTheDocument();
    await userEvent.upload(within(row("Disco ball")).getByLabelText("Upload PSD for Disco ball"), psd("v2.psd"));

    expect(await within(row("Disco ball")).findByText(/1000 × 2304 px/)).toBeInTheDocument();
  });

  it("explains a PSD that cannot be read", async () => {
    api.adminUpload.mockRejectedValue(new AdminApiError("File is not a readable PSD: bad header", 422));
    render(<CampaignDesigns />);
    await screen.findByText("campaign-DISCO_BALL.psd");

    await userEvent.upload(within(row("Beach vibes")).getByLabelText("Upload PSD for Beach vibes"), psd());

    expect(await within(row("Beach vibes")).findByText("File is not a readable PSD: bad header")).toBeInTheDocument();
  });
});
