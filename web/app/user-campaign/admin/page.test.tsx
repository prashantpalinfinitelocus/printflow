import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./AdminApp", () => ({ AdminApp: () => <p>campaign admin</p> }));

import AdminPage, { metadata } from "./page";

describe("campaign admin page", () => {
  it("renders the campaign admin", () => {
    render(<AdminPage />);
    expect(screen.getByText("campaign admin")).toBeInTheDocument();
  });

  it("keeps the page out of search engines", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
