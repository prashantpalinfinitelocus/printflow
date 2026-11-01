import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LegalPage } from "./LegalPage";

const renderTerms = () =>
  render(<LegalPage title="Terms & Conditions" html="<h2>Use of the Site</h2><p>Body copy.</p>" />);

describe("LegalPage", () => {
  it("keeps Back and the logo in a header that stays in view while reading", () => {
    renderTerms();
    const header = screen.getByRole("banner");
    expect(header).toHaveClass("sticky", "top-0");
    expect(header).not.toHaveClass("border-b");
    expect(within(header).getByRole("link", { name: "Back" })).toHaveAttribute("href", "/user-campaign");
    expect(within(header).getByRole("link", { name: "Back" }).className).not.toMatch(/hover:/);
    expect(within(header).getByRole("img", { name: "Diet Coke" })).toBeInTheDocument();
  });

  it("titles the page under the campaign eyebrow", () => {
    renderTerms();
    expect(screen.getByRole("heading", { level: 1, name: "Terms & Conditions" })).toBeInTheDocument();
    expect(screen.getByText(/Diet Coke\s+·\s+Custom Edition/)).toBeInTheDocument();
  });

  it("runs the document the full width from the left, not in a centred column", () => {
    renderTerms();
    expect(screen.getByRole("heading", { level: 2, name: "Use of the Site" })).toBeInTheDocument();
    const article = screen.getByRole("article");
    expect(article).toHaveClass("w-full");
    expect(article).not.toHaveClass("mx-auto");
    expect(article.className).not.toMatch(/max-w-/);
  });

  it("has no footer section", () => {
    renderTerms();
    expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Back to the campaign" })).not.toBeInTheDocument();
  });
});
