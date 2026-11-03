import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./AdminLogin", () => ({ AdminLogin: () => <form aria-label="Sign in form" /> }));

import AdminLoginPage, { metadata } from "./page";

describe("campaign admin login page", () => {
  it("lays the landing's photo behind the whole page, each size getting its own", () => {
    const { container } = render(<AdminLoginPage />);
    const backdrop = container.querySelector("[data-backdrop]");
    expect(backdrop).toHaveAttribute("aria-hidden", "true");
    const srcs = [...(backdrop?.querySelectorAll("img") ?? [])].map((i) => i.getAttribute("src")).join();
    expect(srcs).toMatch(/mobile-bg/);
    expect(srcs).toMatch(/web-landing-bg/);
  });

  it("shows the landing's can on the left from 1024px, and above the card on tall phones", () => {
    const { container } = render(<AdminLoginPage />);
    const slot = container.querySelector("[data-can-slot]");
    // Only phones tall enough for both the can and the card show it.
    expect(slot).toHaveClass("hidden", "[@media(min-height:770px)]:block", "lg:block");
    expect(slot?.querySelector("img")?.getAttribute("src")).toMatch(/landing-can/);
  });

  it("opens with a headline that says what signing in is for", () => {
    render(<AdminLoginPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Ready to pick today’s lucky few?" })).toBeInTheDocument();
    expect(screen.getByText(/run the daily draw, make the winners’ print files and download the sheet/)).toBeInTheDocument();
    expect(screen.queryByText(/campaign admin/i)).not.toBeInTheDocument();
  });

  it("floats the can, and moves the shadow with it, inside one shared sideways box", () => {
    const { container } = render(<AdminLoginPage />);
    const sideways = container.querySelector("[data-float-x]");
    expect(sideways).toHaveClass("animate-float-x");
    expect(sideways).toContainElement(container.querySelector("[data-can]"));
    expect(sideways).toContainElement(container.querySelector("[data-shadow]"));
    expect(container.querySelector("[data-can]")).toHaveClass("animate-float-can", "rotate-[17.91deg]");
    expect(container.querySelector("[data-shadow]")).toHaveClass("animate-float-shadow");
  });

  it("puts the headline and form in one left-aligned card", () => {
    render(<AdminLoginPage />);
    const card = screen.getByRole("heading", { level: 1 }).closest("[data-card]");
    expect(card).toContainElement(screen.getByRole("form", { name: "Sign in form" }));
    expect(card).toHaveClass("rounded-[28px]", "bg-white/75");
    expect(card?.className).not.toMatch(/text-center/);
    expect(screen.getByRole("heading", { level: 1 }).closest("[data-panel]")).toHaveClass("lg:left-[59.03%]");
  });

  it("keeps the logo top right on phones and top left on web, where the landing has it", () => {
    render(<AdminLoginPage />);
    expect(screen.getByRole("img", { name: "Diet Coke" })).toHaveClass("top-4", "right-4", "lg:top-10", "lg:left-10");
  });

  it("has no line about asking for an account", () => {
    render(<AdminLoginPage />);
    expect(screen.queryByText(/No account\?/)).not.toBeInTheDocument();
  });

  it("keeps the page out of search engines", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
