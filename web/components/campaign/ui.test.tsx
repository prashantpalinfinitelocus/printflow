import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CircleButton, FieldError, Modal, PillButton } from "./ui";

describe("PillButton", () => {
  it("runs its action when clicked", async () => {
    const onClick = vi.fn();
    render(<PillButton onClick={onClick}>Submit</PillButton>);
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("is disabled and shows a spinner while busy, so a double tap cannot resubmit", async () => {
    const onClick = vi.fn();
    render(
      <PillButton busy onClick={onClick}>
        Submit
      </PillButton>,
    );
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("Modal", () => {
  it("is a modal dialog named by its title", () => {
    render(<Modal figmaTop={186}>{(titleId) => <h2 id={titleId}>Login</h2>}</Modal>);
    expect(screen.getByRole("dialog", { name: "Login" })).toHaveAttribute("aria-modal", "true");
  });

  it("closes from the close button", async () => {
    const onClose = vi.fn();
    render(<Modal figmaTop={186} onClose={onClose}>{(id) => <h2 id={id}>Login</h2>}</Modal>);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(<Modal figmaTop={186} onClose={onClose}>{(id) => <h2 id={id}>Login</h2>}</Modal>);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps its Figma top as an offset from the centre by default", () => {
    render(<Modal figmaTop={209}>{(id) => <h2 id={id}>Heads up</h2>}</Modal>);
    expect(screen.getByRole("dialog").style.getPropertyValue("--dc-top")).toBe("calc(50% - 178.5px)");
  });

  it("keeps its Figma top as a distance from the foot when anchored to the bottom", () => {
    // 775 − 186 = 589: on the 874px Figma frame that puts the card at 285, as designed.
    render(<Modal figmaTop={186} anchor="bottom">{(id) => <h2 id={id}>Login</h2>}</Modal>);
    expect(screen.getByRole("dialog").style.getPropertyValue("--dc-top")).toContain("calc(100% - 589px)");
  });

  it("is Figma's 480px web popup, centred on screen, from 1024px up", () => {
    render(<Modal figmaTop={186} anchor="bottom">{(id) => <h2 id={id}>Login</h2>}</Modal>);
    expect(screen.getByRole("dialog")).toHaveClass(
      "top-(--dc-top)",
      "lg:top-1/2",
      "lg:-translate-y-1/2",
      "lg:w-[480px]",
      "lg:max-w-[480px]",
      "lg:rounded-3xl",
    );
  });

  it("has no close button when it must be answered", () => {
    render(<Modal figmaTop={186}>{(id) => <h2 id={id}>Login</h2>}</Modal>);
    expect(screen.getByRole("dialog", { name: "Login" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });
});

describe("CircleButton", () => {
  it("names an icon-only button for screen readers", () => {
    render(
      <CircleButton label="Download My Can">
        <svg />
      </CircleButton>,
    );
    expect(screen.getByRole("button", { name: "Download My Can" })).toBeInTheDocument();
  });
});

describe("FieldError", () => {
  it("announces the message", () => {
    render(<FieldError>Enter a valid email</FieldError>);
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid email");
  });

  it("is Figma's error line: a red alert icon, 8px gap, 12/16 red text", () => {
    render(<FieldError>Enter a valid email</FieldError>);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveClass("flex", "gap-2", "text-xs", "leading-4", "text-[#F40009]");
    const icon = alert.querySelector("svg[data-icon='alert']");
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon).toHaveAttribute("width", "16");
  });

  it("takes the popup's font and alignment", () => {
    render(<FieldError className="justify-center">Incorrect code</FieldError>);
    expect(screen.getByRole("alert")).toHaveClass("justify-center");
  });

  it("renders nothing without a message", () => {
    render(<FieldError>{null}</FieldError>);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
