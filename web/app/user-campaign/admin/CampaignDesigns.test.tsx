import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminApiError, type CampaignDesign, type DesignFormat } from "@/lib/campaign/admin";
import { DESIGNS } from "@/lib/campaign/designs";

import { CampaignDesigns } from "./CampaignDesigns";

const api = vi.hoisted(() => ({
  adminGet: vi.fn(),
  adminPost: vi.fn(),
  adminPatch: vi.fn(),
  adminUpload: vi.fn(),
  adminDelete: vi.fn(),
}));
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


describe("adding, hiding and deleting designs", () => {
  it("adds a design with a name, category and sticker, and lists it with its sticker", async () => {
    const onSaved = vi.fn();
    api.adminUpload.mockResolvedValue({ design_id: "SUMMER_SPLASH", name: "Summer splash", category: "Travel", active: true, version: 1 });
    render(<CampaignDesigns onSaved={onSaved} />);
    await screen.findByText("campaign-DISCO_BALL.psd");

    const form = screen.getByRole("form", { name: "Add a design" });
    await userEvent.type(within(form).getByLabelText("Name"), "Summer splash");
    await userEvent.selectOptions(within(form).getByLabelText("Category"), "Travel");
    await userEvent.upload(within(form).getByLabelText("Sticker image"), new File(["png"], "s.png", { type: "image/png" }));
    list = [...list, summer({ version: 1 })];
    await userEvent.click(within(form).getByRole("button", { name: "Add design" }));

    expect(api.adminUpload).toHaveBeenCalledWith("/catalog", expect.any(File), { name: "Summer splash", category: "Travel" });
    const added = await screen.findByRole("listitem", { name: "Summer splash" });
    expect(within(added).getByRole("img")).toHaveAttribute("src", "/user-campaign/api/admin/catalog/SUMMER_SPLASH/sticker?v=1");
    expect(onSaved).toHaveBeenCalled();
  });

  it("asks for a name and a sticker before adding", async () => {
    render(<CampaignDesigns />);
    await screen.findByText("campaign-DISCO_BALL.psd");
    await userEvent.click(screen.getByRole("button", { name: "Add design" }));

    expect(screen.getByRole("form", { name: "Add a design" })).toHaveTextContent("Give the design a name and choose its sticker image.");
    expect(api.adminUpload).not.toHaveBeenCalled();
  });

  it("hides a built-in design from users and shows it again", async () => {
    api.adminPatch.mockImplementation(async (_: string, body: { active: boolean }) => builtin("DISCO_BALL", { active: body.active }));
    render(<CampaignDesigns />);
    await screen.findByText("campaign-DISCO_BALL.psd");

    await userEvent.click(within(row("Disco ball")).getByRole("button", { name: "Hide from users" }));
    expect(api.adminPatch).toHaveBeenCalledWith("/designs/DISCO_BALL/visibility", { active: false });
    expect(await within(row("Disco ball")).findByText("Hidden")).toBeInTheDocument();

    await userEvent.click(within(row("Disco ball")).getByRole("button", { name: "Show to users" }));
    expect(api.adminPatch).toHaveBeenLastCalledWith("/designs/DISCO_BALL/visibility", { active: true });
  });

  it("deletes an added design after asking", async () => {
    list = [...list, summer()];
    vi.spyOn(window, "confirm").mockReturnValue(true);
    api.adminDelete.mockResolvedValue(undefined);
    render(<CampaignDesigns />);
    await screen.findByRole("listitem", { name: "Summer splash" });

    list = list.filter((d) => d.design_id !== "SUMMER_SPLASH");
    await userEvent.click(within(row("Summer splash")).getByRole("button", { name: "Delete" }));

    expect(window.confirm).toHaveBeenCalledWith("Delete Summer splash? This cannot be undone.");
    expect(api.adminDelete).toHaveBeenCalledWith("/catalog/SUMMER_SPLASH");
    await waitFor(() => expect(screen.queryByRole("listitem", { name: "Summer splash" })).not.toBeInTheDocument());
  });

  it("explains why a design people entered with can only be hidden", async () => {
    list = [...list, summer()];
    vi.spyOn(window, "confirm").mockReturnValue(true);
    api.adminDelete.mockRejectedValue(new AdminApiError("People have entered with this design, so it can't be deleted. Hide it instead.", 409));
    render(<CampaignDesigns />);
    await screen.findByRole("listitem", { name: "Summer splash" });

    await userEvent.click(within(row("Summer splash")).getByRole("button", { name: "Delete" }));

    expect(await within(row("Summer splash")).findByText(/Hide it instead/)).toBeInTheDocument();
  });

  it("offers Delete and Replace sticker only on added designs", async () => {
    list = [...list, summer()];
    render(<CampaignDesigns />);
    await screen.findByRole("listitem", { name: "Summer splash" });

    expect(within(row("Disco ball")).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(within(row("Disco ball")).queryByLabelText(/Replace sticker/)).not.toBeInTheDocument();
    expect(within(row("Summer splash")).getByLabelText("Replace sticker for Summer splash")).toBeInTheDocument();
  });

  it("replaces an added design's sticker", async () => {
    list = [...list, summer()];
    api.adminUpload.mockResolvedValue({ design_id: "SUMMER_SPLASH", name: "Summer splash", category: "Travel", active: true, version: 3 });
    render(<CampaignDesigns />);
    await screen.findByRole("listitem", { name: "Summer splash" });

    list = [...list.slice(0, -1), summer({ version: 3 })];
    await userEvent.upload(within(row("Summer splash")).getByLabelText("Replace sticker for Summer splash"), new File(["png"], "n.png", { type: "image/png" }));

    expect(api.adminUpload).toHaveBeenCalledWith("/catalog/SUMMER_SPLASH/sticker", expect.any(File));
    await waitFor(() =>
      expect(within(row("Summer splash")).getByRole("img")).toHaveAttribute("src", "/user-campaign/api/admin/catalog/SUMMER_SPLASH/sticker?v=3"),
    );
  });
});
