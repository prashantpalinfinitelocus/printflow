import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminApiError, type CampaignDay, type CampaignWinner } from "@/lib/campaign/admin";

import { CampaignWinners } from "./CampaignWinners";

const client = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/campaign/admin", async (actual) => ({
  ...(await actual<typeof import("@/lib/campaign/admin")>()),
  adminGet: client.get,
  adminPost: client.post,
}));
// The Designs section has its own tests; here it only has to be on the page, below the winners.
vi.mock("./CampaignDesigns", () => ({ CampaignDesigns: () => <section id="designs">Designs</section> }));

const DAY = "2026-10-30";

const winner = (over: Partial<CampaignWinner> = {}): CampaignWinner => ({
  id: 1,
  rank: 1,
  entry_id: "e-1",
  phone: "9000000001",
  email: "aanya@example.com",
  design_id: "DISCO_BALL",
  text: "Aanya",
  entered_at: "2026-10-30T07:00:00Z",
  tiff_ready: false,
  tiff_error: null,
  tiff_generated_at: null,
  ...over,
});

const day = (over: Partial<CampaignDay> = {}): CampaignDay => ({
  day: DAY,
  entries: 12,
  can_draw: false,
  draw: { eligible_entries: 12, winner_count: 2, created_at: "2026-10-30T17:00:00Z" },
  winners: [winner(), winner({ id: 2, rank: 2, phone: "9000000002", email: "riya@example.com", text: "Riya" })],
  missing_formats: [],
  ...over,
});

beforeEach(() => {
  client.get.mockResolvedValue(day());
});

afterEach(() => {
  client.get.mockReset();
  client.post.mockReset();
});

describe("CampaignWinners", () => {
  it("loads the day and lists each winner with their contact details, design and text", async () => {
    render(<CampaignWinners initialDay={DAY} />);

    const table = await screen.findByRole("table");
    expect(client.get).toHaveBeenCalledWith(`/days/${DAY}`);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("9000000001")).toBeInTheDocument();
    expect(within(rows[0]).getByText("aanya@example.com")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Disco ball")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Aanya")).toBeInTheDocument();
    expect(screen.getByText("Entries").nextSibling).toHaveTextContent("12");
    expect(screen.getByText("Winners").nextSibling).toHaveTextContent("2");
    expect(screen.getByText("TIFFs ready").nextSibling).toHaveTextContent("0 / 2");
  });

  it("offers the draw once the day's entries have closed, and shows the winners it picks", async () => {
    client.get.mockResolvedValue(day({ can_draw: true, draw: null, winners: [] }));
    client.post.mockResolvedValue(day());
    render(<CampaignWinners initialDay={DAY} />);

    await userEvent.click(await screen.findByRole("button", { name: "Run draw" }));

    expect(client.post).toHaveBeenCalledWith(`/days/${DAY}/draw`);
    expect(await screen.findAllByRole("row")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Run draw" })).not.toBeInTheDocument();
  });

  it("explains that a day still taking entries cannot be drawn yet", async () => {
    client.get.mockResolvedValue(day({ can_draw: false, draw: null, winners: [] }));
    render(<CampaignWinners initialDay={DAY} />);

    expect(await screen.findByText(/draw runs after this day’s entries close at 10 PM IST/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run draw" })).not.toBeInTheDocument();
  });

  it("names the designs that still need their PSD, pointing to the Designs section below", async () => {
    client.get.mockResolvedValue(day({ missing_formats: ["BEACH_VIBES"] }));
    render(<CampaignWinners initialDay={DAY} />);

    const warning = await screen.findByText(/No PSD set up for Beach vibes \(BEACH_VIBES\)/);
    // Set up here on the campaign admin, never on the store app's pages.
    const link = within(warning.closest("[role=status]") as HTMLElement).getByRole("link", { name: "Designs" });
    expect(link).toHaveAttribute("href", "#designs");
    expect(document.body.innerHTML).not.toMatch(/\/admin\/formats|offline-store\/admin/);
  });

  it("generates the TIFFs one at a time, skipping designs with no print format, then links each download", async () => {
    client.get.mockResolvedValue(
      day({
        winners: [winner(), winner({ id: 2, rank: 2, design_id: "BEACH_VIBES" }), winner({ id: 3, rank: 3 })],
        missing_formats: ["BEACH_VIBES"],
      }),
    );
    client.post.mockImplementation(async (path: string) => winner({ id: Number(path.split("/")[2]), tiff_ready: true }));
    render(<CampaignWinners initialDay={DAY} />);

    await userEvent.click(await screen.findByRole("button", { name: "Generate TIFFs (2)" }));

    await waitFor(() => expect(screen.getAllByRole("link", { name: "Download TIFF" })).toHaveLength(2));
    expect(client.post.mock.calls.map(([path]) => path)).toEqual([
      "/winners/1/tiff",
      "/winners/3/tiff",
    ]);
    expect(screen.getAllByRole("link", { name: "Download TIFF" })[0]).toHaveAttribute(
      "href",
      "/user-campaign/api/admin/winners/1/tiff",
    );
  });

  it("finishes generating under React's StrictMode, which mounts every component twice in development", async () => {
    client.post.mockImplementation(async (path: string) => winner({ id: Number(path.split("/")[2]), tiff_ready: true }));
    render(
      <StrictMode>
        <CampaignWinners initialDay={DAY} />
      </StrictMode>,
    );

    await userEvent.click(await screen.findByRole("button", { name: "Generate TIFFs (2)" }));

    await waitFor(() => expect(screen.getAllByRole("link", { name: "Download TIFF" })).toHaveLength(2));
    expect(screen.queryByText(/Generating TIFF/)).not.toBeInTheDocument();
  });

  it("calls a design with no PSD 'No PSD set up', as the sheet does", async () => {
    client.get.mockResolvedValue(day({ winners: [winner({ design_id: "BEACH_VIBES" })], missing_formats: ["BEACH_VIBES"] }));
    render(<CampaignWinners initialDay={DAY} />);

    expect(await within(await screen.findByRole("table")).findByText("No PSD set up")).toBeInTheDocument();
  });

  it("keeps going after one TIFF fails and shows why it failed", async () => {
    client.post
      .mockRejectedValueOnce(new Error("TIFF failed: font missing"))
      .mockResolvedValueOnce(winner({ id: 2, rank: 2, tiff_ready: true }));
    render(<CampaignWinners initialDay={DAY} />);

    await userEvent.click(await screen.findByRole("button", { name: "Generate TIFFs (2)" }));

    expect(await screen.findByText("TIFF failed: font missing")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole("link", { name: "Download TIFF" })).toHaveLength(1));
  });

  it("stops generating when the admin's login has expired, instead of failing every winner", async () => {
    client.post.mockRejectedValue(new AdminApiError("Token expired", 401));
    render(<CampaignWinners initialDay={DAY} />);

    await userEvent.click(await screen.findByRole("button", { name: "Generate TIFFs (2)" }));

    expect(await screen.findByText(/Your login has expired/)).toBeInTheDocument();
    expect(client.post).toHaveBeenCalledTimes(1);
  });

  it("ignores a slow answer for a day the admin has already moved away from", async () => {
    let answerFirst: (d: CampaignDay) => void = () => {};
    client.get
      .mockReturnValueOnce(new Promise((r) => (answerFirst = r)))
      .mockResolvedValueOnce(day({ day: "2026-10-29", entries: 7 }));
    render(<CampaignWinners initialDay={DAY} />);

    fireEvent.change(screen.getByLabelText("Draw day"), { target: { value: "2026-10-29" } });
    await waitFor(() => expect(screen.getByText("Entries").nextSibling).toHaveTextContent("7"));
    answerFirst(day({ entries: 12 }));

    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText("Entries").nextSibling).toHaveTextContent("7");
  });

  it("downloads the sheet with TIFF links that open through this site", async () => {
    render(<CampaignWinners initialDay={DAY} />);

    const link = await screen.findByRole("link", { name: "Download sheet" });
    const href = new URL(link.getAttribute("href")!, "http://localhost");
    expect(href.pathname).toBe(`/user-campaign/api/admin/days/${DAY}/winners.csv`);
    expect(href.searchParams.get("link_base")).toBe(`${window.location.origin}/user-campaign/api/admin`);
  });

  it("shows that the day is loading", async () => {
    let resolve: (d: CampaignDay) => void = () => {};
    client.get.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<CampaignWinners initialDay={DAY} />);

    expect(await screen.findByText("Loading 2026-10-30…")).toBeInTheDocument();
    resolve(day());
    await screen.findByRole("table");
    expect(screen.queryByText(/Loading/)).not.toBeInTheDocument();
  });

  it("loads another day when the date changes", async () => {
    render(<CampaignWinners initialDay={DAY} />);
    await screen.findByRole("table");

    fireEvent.change(screen.getByLabelText("Draw day"), { target: { value: "2026-10-29" } });

    await waitFor(() => expect(client.get).toHaveBeenLastCalledWith("/days/2026-10-29"));
  });
});
