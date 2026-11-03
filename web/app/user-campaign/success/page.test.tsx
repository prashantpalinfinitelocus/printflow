import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { gaEventNames } from "@/test/campaign";

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

  it("switches to Figma's web success (356:1102) from 1024px up", () => {
    const { container } = render(<SuccessPage />);
    expect(container.querySelector("[data-web-logos]")).toHaveClass("hidden", "lg:block");
    // The photo plus the small logo top left; no second logo top right.
    expect(container.querySelector("[data-web-logos]")?.querySelectorAll("img")).toHaveLength(2);
    expect(container.querySelector("[data-web-logos] img.right-10")).toBeNull();
    const heading = screen.getByRole("heading", { name: "You ate! Your entry is in.." });
    expect(heading.parentElement?.parentElement).toHaveClass("lg:top-[39.23%]", "lg:w-[612px]");
    expect(screen.getByText("You ate!")).toHaveClass("lg:text-[32px]", "lg:leading-[36.48px]");
    expect(screen.getByText(/fingers crossed/i)).toHaveClass("lg:w-auto", "lg:text-[27.19px]", "lg:leading-[35.69px]");
  });

  it("asks for the phone photo at the screen's width, so tablets get a sharp one", () => {
    render(<SuccessPage />);
    const phone = document.head.querySelector('link[rel="preload"][media="(max-width: 1023px)"]');
    expect(phone?.getAttribute("imagesizes")).toBe("100vw");
  });

  it("serves every image at quality 90, and preloads the same files", () => {
    const { container } = render(<SuccessPage />);
    for (const img of container.querySelectorAll("img")) expect(img.getAttribute("src")).toMatch(/\?q=90$/);
    for (const l of document.head.querySelectorAll('link[rel="preload"][as="image"]')) expect(l.getAttribute("imagesrcset")).toMatch(/\?q=90 /);
  });

  it("preloads only the photo each screen size shows", () => {
    render(<SuccessPage />);
    const preloads = [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="image"]')];
    expect(preloads.find((l) => l.media === "(max-width: 1023px)")?.getAttribute("imagesrcset")).toMatch(/success-bg/);
    expect(preloads.find((l) => l.media === "(min-width: 1024px)")?.getAttribute("imagesrcset")).toMatch(/web-success-bg/);
    expect(preloads.filter((l) => !l.media)).toHaveLength(0);
  });

  it("counts the thank-you view", () => {
    render(<SuccessPage />);
    expect(gaEventNames()).toEqual(["thank_you_viewed"]);
  });
});
