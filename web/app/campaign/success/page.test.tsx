import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import SuccessPage from "./page";

describe("Success", () => {
  it("confirms the entry with the Figma copy", () => {
    render(<SuccessPage />);
    expect(screen.getByRole("heading", { name: "You ate! Your entry is in.." })).toBeInTheDocument();
    expect(screen.getByText(/fingers crossed! if you’re selected, we’ll hit your inbox/i)).toBeInTheDocument();
  });

  it("never implies the entry has won (PRD 10)", () => {
    const { container } = render(<SuccessPage />);
    expect(container.textContent).toMatch(/fingers crossed/i);
    expect(container.textContent).not.toMatch(/\b(won|winner|on its way|reserved)\b/i);
  });
});
