import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminLogin } from "./AdminLogin";

const assign = vi.fn();
const upstream = vi.fn();

beforeEach(() => {
  vi.stubGlobal("location", { ...window.location, assign });
  vi.stubGlobal("fetch", upstream);
});
afterEach(() => {
  vi.unstubAllGlobals();
  assign.mockReset();
  upstream.mockReset();
});

async function signIn(userId = "ops", password = "secret-pass") {
  render(<AdminLogin />);
  await userEvent.type(screen.getByLabelText("User ID"), userId);
  await userEvent.type(screen.getByLabelText("Password"), password);
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("AdminLogin", () => {
  it("signs in with a user ID and password through the campaign admin's own route", async () => {
    upstream.mockResolvedValue(new Response(JSON.stringify({ admin: { username: "ops" } }), { status: 200 }));

    await signIn();

    expect(upstream).toHaveBeenCalledWith(
      "/user-campaign/api/admin/auth/login",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ username: "ops", password: "secret-pass" }) }),
    );
    expect(assign).toHaveBeenCalledWith("/user-campaign/admin");
  });

  it("shows why a sign-in failed and stays on the page", async () => {
    upstream.mockResolvedValue(new Response(JSON.stringify({ detail: "Wrong user ID or password" }), { status: 401 }));

    await signIn();

    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong user ID or password");
    expect(assign).not.toHaveBeenCalled();
  });

  it("keeps the fields white, so they read over the backdrop photo", () => {
    render(<AdminLogin />);
    expect(screen.getByLabelText("User ID")).toHaveClass("bg-white");
    expect(screen.getByLabelText("Password")).toHaveClass("bg-white");
  });

  it("shows and hides the password on request", async () => {
    render(<AdminLogin />);
    const password = screen.getByLabelText("Password");
    expect(password).toHaveAttribute("type", "password");

    await userEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(password).toHaveAttribute("type", "text");
    await userEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(password).toHaveAttribute("type", "password");
  });

  it("asks for both fields before trying", async () => {
    render(<AdminLogin />);
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Enter your user ID and password");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("explains when the server cannot be reached", async () => {
    upstream.mockRejectedValue(new TypeError("Failed to fetch"));

    await signIn();

    expect(await screen.findByRole("alert")).toHaveTextContent("Can’t reach the server");
  });
});
