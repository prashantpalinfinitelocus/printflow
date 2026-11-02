import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminApp } from "./AdminApp";

const api = vi.hoisted(() => ({ adminGet: vi.fn(), adminPost: vi.fn() }));
vi.mock("@/lib/campaign/admin", async (actual) => ({ ...(await actual<typeof import("@/lib/campaign/admin")>()), ...api }));
vi.mock("./CampaignWinners", () => ({ CampaignWinners: ({ initialDay }: { initialDay: string }) => <p>winners for {initialDay}</p> }));

const assign = vi.fn();
beforeEach(() => vi.stubGlobal("location", { ...window.location, assign }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("AdminApp", () => {
  it("shows nothing of the panel until the campaign admin's sign-in is confirmed", async () => {
    api.adminGet.mockReturnValue(new Promise(() => {}));
    render(<AdminApp />);

    expect(screen.getByText("Checking your sign-in…")).toBeInTheDocument();
    expect(screen.queryByText(/winners for/)).not.toBeInTheDocument();
    expect(api.adminGet).toHaveBeenCalledWith("/auth/me");
  });

  it("shows the panel and who is signed in, opening on yesterday as of now in India, not as of the build", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-04T09:00:00Z"));
    api.adminGet.mockResolvedValue({ username: "ops" });
    render(<AdminApp />);

    expect(await screen.findByText("winners for 2026-11-03")).toBeInTheDocument();
    vi.useRealTimers();
    expect(screen.getByText("ops")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Daily winners" })).toBeInTheDocument();
  });

  it("signs out and returns to the campaign admin login", async () => {
    api.adminGet.mockResolvedValue({ username: "ops" });
    api.adminPost.mockResolvedValue(undefined);
    render(<AdminApp />);

    await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));

    expect(api.adminPost).toHaveBeenCalledWith("/auth/logout");
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/user-campaign/admin/login"));
  });
});
