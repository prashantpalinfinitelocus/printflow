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

  it("renders nothing without a message", () => {
    render(<FieldError>{null}</FieldError>);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
