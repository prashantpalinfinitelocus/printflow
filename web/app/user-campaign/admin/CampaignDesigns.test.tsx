import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminApiError, type CampaignDesign, type DesignFormat } from "@/lib/campaign/admin";
import { DESIGNS } from "@/lib/campaign/designs";

import { CampaignDesigns } from "./CampaignDesigns";

const api = vi.hoisted(() => ({ adminGet: vi.fn(), adminPost: vi.fn(), adminPatch: vi.fn(), adminUpload: vi.fn() }));
vi.mock("@/lib/campaign/admin", async (actual) => ({ ...(await actual<typeof import("@/lib/campaign/admin")>()), ...api }));

const FONTS = [{ filename: "You2013 Regular.ttf", family: "You2013" }, { filename: "TCCC-UnityText-Bold.ttf", family: null }];

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

const designs = (): CampaignDesign[] =>
  DESIGNS.map((d) => ({ design_id: d.id, format: d.id === "DISCO_BALL" ? discoBall : null }));

const psd = (name = "beach.psd") => new File(["8BPS"], name, { type: "image/vnd.adobe.photoshop" });
const row = (name: string) => screen.getByRole("listitem", { name });

beforeEach(() => {
  api.adminGet.mockImplementation(async (path: string) => (path === "/fonts" ? FONTS : designs()));
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

  it("edits where and how the text is printed", async () => {
    api.adminPatch.mockImplementation(async (_: string, body: Partial<DesignFormat>) => ({ design_id: "DISCO_BALL", format: { ...discoBall, ...body } }));
    render(<CampaignDesigns />);
    await screen.findByText("campaign-DISCO_BALL.psd");

    await userEvent.click(within(row("Disco ball")).getByRole("button", { name: "Edit text settings" }));
    const size = screen.getByLabelText("Font size (px)");
    await userEvent.clear(size);
    await userEvent.type(size, "60");
    await userEvent.selectOptions(screen.getByLabelText("Font"), "TCCC-UnityText-Bold.ttf");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.adminPatch).toHaveBeenCalledWith("/designs/DISCO_BALL", {
        text_box: discoBall.text_box,
        font_path: "TCCC-UnityText-Bold.ttf",
        font_size: 60,
        font_color: "#F40009",
        placeholder_color: null,
      }),
    );
    expect(await within(row("Disco ball")).findByText(/TCCC-UnityText-Bold\.ttf · 60px/)).toBeInTheDocument();
  });

  it("finds the red XXXXXXXX placeholder on request, shows the box, and erases it when printing", async () => {
    api.adminPost.mockResolvedValue({ text_box: { x: 200, y: 1100, w: 500, h: 80 }, fill: 0.4 });
    api.adminPatch.mockImplementation(async (_: string, body: Partial<DesignFormat>) => ({ design_id: "DISCO_BALL", format: { ...discoBall, ...body } }));
    render(<CampaignDesigns />);
    await screen.findByText("campaign-DISCO_BALL.psd");

    await userEvent.click(within(row("Disco ball")).getByRole("button", { name: "Edit text settings" }));
    await userEvent.click(screen.getByRole("button", { name: "Find red XXXXXXXX placeholder" }));

    expect(api.adminPost).toHaveBeenCalledWith("/designs/DISCO_BALL/find-placeholder", {
      color: "#ED1C24",
      expected_w: 652,
      expected_h: 86,
    });
    expect(await screen.findByText(/Found a 500 × 80 px placeholder at 200,1100/)).toBeInTheDocument();
    expect(screen.getByLabelText("Left")).toHaveValue(200);
    expect(screen.getByLabelText("Erase the red placeholder before printing")).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.adminPatch).toHaveBeenCalledWith(
        "/designs/DISCO_BALL",
        expect.objectContaining({ text_box: { x: 200, y: 1100, w: 500, h: 80 }, placeholder_color: "#ED1C24" }),
      ),
    );
  });

  it("explains a PSD that cannot be read", async () => {
    api.adminUpload.mockRejectedValue(new AdminApiError("File is not a readable PSD: bad header", 422));
    render(<CampaignDesigns />);
    await screen.findByText("campaign-DISCO_BALL.psd");

    await userEvent.upload(within(row("Beach vibes")).getByLabelText("Upload PSD for Beach vibes"), psd());

    expect(await within(row("Beach vibes")).findByText("File is not a readable PSD: bad header")).toBeInTheDocument();
  });
});
