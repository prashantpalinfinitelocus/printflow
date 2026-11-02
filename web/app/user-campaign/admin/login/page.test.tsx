import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./AdminLogin", () => ({ AdminLogin: () => <form aria-label="Sign in form" /> }));

import AdminLoginPage, { metadata } from "./page";

describe("campaign admin login page", () => {
  it("lays the landing's sunlight backdrop behind the whole page", () => {
    const { container } = render(<AdminLoginPage />);
    const backdrop = container.querySelector("[data-backdrop]");
    expect(backdrop).toHaveAttribute("aria-hidden", "true");
    expect(backdrop?.querySelector("img")?.getAttribute("src")).toMatch(/web-bg/);
  });

  it("shows the can-in-hands photo on the left from 1024px, as the landing does", () => {
    const { container } = render(<AdminLoginPage />);
    const hands = container.querySelector("[data-hands]");
    expect(hands).toHaveClass("hidden", "lg:block");
    const srcs = [...(hands?.querySelectorAll("img") ?? [])].map((i) => i.getAttribute("src"));
    expect(srcs.join()).toMatch(/web-landing-hands/);
    expect(srcs.join()).toMatch(/web-landing-can/);
  });

  it("opens with a headline that says what signing in is for", () => {
    render(<AdminLoginPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Ready to pick today’s lucky few?" })).toBeInTheDocument();
    expect(screen.getByText(/run the daily draw, make the winners’ print files and download the sheet/)).toBeInTheDocument();
    expect(screen.queryByText(/campaign admin/i)).not.toBeInTheDocument();
  });

  it("drops the can into its tilt, then lets it drift in a slow circle; still for reduced motion", () => {
    const { container } = render(<AdminLoginPage />);
    const can = container.querySelector("[data-hands] [data-can]");
    expect(can).toHaveClass("animate-can-float", "motion-reduce:animate-none", "rotate-[9deg]");
  });

  it("puts the sign-in straight on the backdrop, with no box, on the right and centred on phones", () => {
    render(<AdminLoginPage />);
    const panel = screen.getByRole("heading", { level: 1 }).closest("[data-panel]");
    expect(panel).toHaveClass("lg:left-[57.08%]");
    expect(panel?.className).not.toMatch(/\bbg-white\b|rounded|shadow/);
    expect(panel).toContainElement(screen.getByRole("form", { name: "Sign in form" }));
  });

  it("keeps the logo in the top-right corner, where the landing has it", () => {
    render(<AdminLoginPage />);
    expect(screen.getByRole("img", { name: "Diet Coke" })).toHaveClass("lg:top-10", "lg:right-10");
  });

  it("has no line about asking for an account", () => {
    render(<AdminLoginPage />);
    expect(screen.queryByText(/No account\?/)).not.toBeInTheDocument();
  });

  it("keeps the page out of search engines", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
