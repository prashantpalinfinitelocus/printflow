import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CampaignError, CampaignServerError, MOCK_OTP, createMockCampaignApi, type CampaignApi } from "@/lib/campaign/api";

import { LoginFlow } from "./LoginFlow";

let api: CampaignApi;
let user: ReturnType<typeof userEvent.setup>;
const onClose = vi.fn();
const onVerified = vi.fn();

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  api = createMockCampaignApi();
  onClose.mockReset();
  onVerified.mockReset();
});

afterEach(() => vi.useRealTimers());

const renderFlow = () => render(<LoginFlow api={api} onClose={onClose} onVerified={onVerified} />);

async function fillDetails(phone = "9876543210", email = "aanya@example.com") {
  await user.type(screen.getByLabelText("Your mobile number"), phone);
  await user.type(screen.getByLabelText("your email ID"), email);
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "Submit" }));
}

/** Gets to the OTP popup with the mock's latency elapsed. */
async function reachOtp() {
  renderFlow();
  await fillDetails();
  return screen.findByRole("dialog", { name: "Verify OTP" });
}

describe("details step", () => {
  it("shows every problem at once and sends no OTP when the form is empty", async () => {
    const sendOtp = vi.spyOn(api, "sendOtp");
    renderFlow();
    await user.click(screen.getByRole("button", { name: "Submit" }));
    const alerts = screen.getAllByRole("alert").map((a) => a.textContent);
    expect(alerts).toEqual([
      expect.stringMatching(/mobile number/i),
      expect.stringMatching(/email/i),
      expect.stringMatching(/agree to the terms/i),
    ]);
    expect(sendOtp).not.toHaveBeenCalled();
  });

  it("words the field errors as Figma does, each with the alert icon", async () => {
    renderFlow();
    await user.type(screen.getByLabelText("Your mobile number"), "98765432");
    await user.type(screen.getByLabelText("your email ID"), "aanya@gail");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Submit" }));
    const [phoneError, emailError] = screen.getAllByRole("alert");
    expect(phoneError).toHaveTextContent(/^Enter a valid mobile number$/);
    expect(emailError).toHaveTextContent(/^Enter a valid email address$/);
    for (const alert of [phoneError, emailError]) expect(alert.querySelector("svg[data-icon='alert']")).not.toBeNull();
  });

  it("keeps the phone field's grey border on a phone error but turns the email border red, as in Figma", async () => {
    renderFlow();
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(screen.getByLabelText("Your mobile number").parentElement).toHaveClass("border-[#E5E5E5]");
    expect(screen.getByLabelText("your email ID")).toHaveClass("border-[#F40009]");
  });

  it("sets typed text in TCCC-UnityText and only the placeholder in UnityHeadline Light", () => {
    renderFlow();
    for (const input of [screen.getByLabelText("Your mobile number"), screen.getByLabelText("your email ID")]) {
      expect(input).toHaveClass(
        "font-[family-name:var(--dc-text)]",
        "font-normal",
        "placeholder:font-[family-name:var(--dc-headline)]",
        "placeholder:font-light",
      );
    }
  });

  it("blocks submission until the terms are ticked", async () => {
    renderFlow();
    await user.type(screen.getByLabelText("Your mobile number"), "9876543210");
    await user.type(screen.getByLabelText("your email ID"), "aanya@example.com");
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/agree to the terms/i);
    expect(screen.queryByRole("dialog", { name: "Verify OTP" })).not.toBeInTheDocument();
  });

  it("keeps only digits in the mobile field, ten at most", async () => {
    renderFlow();
    const phone = screen.getByLabelText("Your mobile number");
    await user.type(phone, "98-765 43210 99");
    expect(phone).toHaveValue("9876543210");
  });

  it.each(["+91 98765 43210", "+919876543210", "09876543210"])(
    "keeps the national number when %s is pasted or autofilled",
    async (pasted) => {
      renderFlow();
      const phone = screen.getByLabelText("Your mobile number");
      await user.click(phone);
      await user.paste(pasted);
      expect(phone).toHaveValue("9876543210");
    },
  );

  it("does not strip a leading 91 from a real ten-digit number", async () => {
    renderFlow();
    const phone = screen.getByLabelText("Your mobile number");
    await user.type(phone, "9198765432");
    expect(phone).toHaveValue("9198765432");
  });

  it("moves to the OTP popup showing the number the code went to", async () => {
    await reachOtp();
    expect(screen.getByText("+91 98765 43210")).toBeInTheDocument();
  });

  it("stays on the form with a retry message when the OTP cannot be sent", async () => {
    vi.spyOn(api, "sendOtp").mockRejectedValueOnce(new Error("SMS provider down"));
    renderFlow();
    await fillDetails();
    expect(await screen.findByRole("alert")).toHaveTextContent(/try again/i);
    expect(screen.getByRole("dialog", { name: "Login" })).toBeInTheDocument();
  });

  it("shows the server's own reason when the OTP cannot be sent", async () => {
    vi.spyOn(api, "sendOtp").mockRejectedValueOnce(new CampaignServerError("Login is not available right now."));
    renderFlow();
    await fillDetails();
    expect(await screen.findByRole("alert")).toHaveTextContent("Login is not available right now.");
  });

  it("links \"terms of usage\" to the Terms page", () => {
    renderFlow();
    expect(screen.getByRole("link", { name: "terms of usage" })).toHaveAttribute("href", "/user-campaign/terms");
  });

  it("does not tick the agreement when the terms link is clicked", async () => {
    renderFlow();
    const link = screen.getByRole("link", { name: "terms of usage" });
    // jsdom cannot navigate; stop the click there so only the label behaviour is under test.
    link.addEventListener("click", (e) => e.preventDefault());
    await user.click(link);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("sits where Figma puts it over the landing page, measured from the foot", () => {
    renderFlow();
    expect(screen.getByRole("dialog", { name: "Login" }).style.getPropertyValue("--dc-top")).toContain("calc(100% - 589px)");
  });

  it("switches to Figma's web login popup from 1024px up", () => {
    renderFlow();
    const dialog = screen.getByRole("dialog", { name: "Login" });
    expect(dialog).toHaveClass("lg:p-8");
    expect(dialog.querySelector("form")).toHaveClass("lg:gap-6");
    expect(screen.getByRole("heading", { name: "Login" })).toHaveClass("lg:text-left", "lg:font-[family-name:var(--dc-text)]");
    expect(screen.getByText("Your mobile number")).toHaveClass("lg:font-[family-name:var(--dc-text)]");
    expect(screen.getByRole("button", { name: "Submit" })).toHaveClass("lg:mx-auto", "lg:w-[280px]");
    // Web sets only the phone placeholder in UnityText Regular; the email one stays UnityHeadline Light.
    expect(screen.getByLabelText("Your mobile number")).toHaveClass("lg:placeholder:font-[family-name:var(--dc-text)]", "lg:placeholder:font-normal");
    expect(screen.getByLabelText("your email ID")).not.toHaveClass("lg:placeholder:font-normal");
  });

  it("draws the agreement box at Figma's 12px inside a 16px slot", () => {
    renderFlow();
    expect(screen.getByRole("checkbox")).toHaveClass("m-0.5", "h-3", "w-3");
  });

  it("closes from the close button", async () => {
    renderFlow();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("OTP step", () => {
  const codeInput = () => screen.getByLabelText("6-digit code");
  const boxes = (dialog: HTMLElement) => [...dialog.querySelectorAll<HTMLElement>("div[data-otp-box]")];

  it("logs in with the right code", async () => {
    await reachOtp();
    await user.type(codeInput(), MOCK_OTP);
    await user.click(screen.getByRole("button", { name: "Verify" }));
    await vi.waitFor(() =>
      expect(onVerified).toHaveBeenCalledWith(
        expect.objectContaining({ phone: "9876543210", email: "aanya@example.com" }),
      ),
    );
  });

  it("keeps a wrong code in red boxes with Figma's message, in place of the resend line", async () => {
    const dialog = await reachOtp();
    await user.type(codeInput(), "482196");
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/^Incorrect code\. Please try again\.$/);
    expect(codeInput()).toHaveValue("482196");
    for (const box of boxes(dialog)) expect(box).toHaveClass("border-[1.5px]", "border-[#F40009]");
    expect(screen.queryByText(/didn.t get the code/i)).not.toBeInTheDocument();
    expect(onVerified).not.toHaveBeenCalled();
    // Centred under the boxes on phones; on web Figma lines it up with the first box.
    expect(screen.getByRole("alert")).toHaveClass("justify-center", "lg:justify-start");
    expect(screen.getByRole("alert").parentElement).toHaveClass("mx-auto", "w-full", "max-w-[268px]");
  });

  it("starts a fresh code when the user types after a wrong one", async () => {
    await reachOtp();
    await user.type(codeInput(), "482196");
    await user.click(screen.getByRole("button", { name: "Verify" }));
    await screen.findByRole("alert");
    await user.type(codeInput(), "1");
    expect(codeInput()).toHaveValue("1");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText(/didn.t get the code/i)).toBeInTheDocument();
  });

  it("greys out an expired code and offers Resend OTP as the main button", async () => {
    const dialog = await reachOtp();
    vi.spyOn(api, "verifyOtp").mockRejectedValueOnce(new CampaignError("OTP_EXPIRED", "That code has expired."));
    await user.type(codeInput(), "482196");
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/^This code has expired\.$/);
    expect(screen.getByText("Request a new code to continue.")).toBeInTheDocument();
    for (const box of boxes(dialog)) expect(box).toHaveClass("bg-[#F7F7F7]", "border-[#E5E5E5]", "text-[#8A8A8A]");
    expect(codeInput()).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Verify" })).not.toBeInTheDocument();

    const sendOtp = vi.spyOn(api, "sendOtp");
    await user.click(screen.getByRole("button", { name: "Resend OTP" }));
    expect(sendOtp).toHaveBeenCalledWith("9876543210", "aanya@example.com");
    expect(await screen.findByRole("button", { name: "Verify" })).toBeInTheDocument();
    expect(codeInput()).toHaveValue("");
    expect(codeInput()).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("greys out Verify until a digit is typed", async () => {
    await reachOtp();
    const verify = screen.getByRole("button", { name: "Verify" });
    expect(verify).toBeDisabled();
    expect(verify).toHaveClass("disabled:bg-[#E5E5E5]", "disabled:text-[#8A8A8A]");
    await user.type(codeInput(), "4");
    expect(verify).toBeEnabled();
  });

  it("asks for all six digits before calling the server", async () => {
    await reachOtp();
    const verifyOtp = vi.spyOn(api, "verifyOtp");
    await user.type(codeInput(), "123");
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/6-digit code/);
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("counts down before allowing a resend, then sends a fresh code", async () => {
    await reachOtp();
    expect(screen.getByText("00:30")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resend OTP" })).not.toBeInTheDocument();

    // Time passes as a whole, like a backgrounded tab whose timers were throttled.
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    const sendOtp = vi.spyOn(api, "sendOtp");
    const link = screen.getByRole("button", { name: "Resend OTP" });
    // Figma: red, bold TCCC-UnityText, underlined.
    expect(link).toHaveClass("text-[#F40009]", "font-bold", "underline", "font-[family-name:var(--dc-text)]");
    await user.click(link);
    expect(sendOtp).toHaveBeenCalledWith("9876543210", "aanya@example.com");
    expect(await screen.findByText("00:30")).toBeInTheDocument();
    // The restarted countdown is the confirmation; Figma has no extra message.
    expect(screen.queryByText(/on its way/i)).not.toBeInTheDocument();
  });

  it("sets the Verify button in TCCC-UnityText like every other button, not the popup's Montserrat", async () => {
    await reachOtp();
    expect(screen.getByRole("button", { name: "Verify" })).toHaveClass("font-[family-name:var(--dc-text)]");
  });

  it("lets the code boxes shrink on narrow phones instead of spilling out of the popup", async () => {
    const dialog = await reachOtp();
    const all = boxes(dialog);
    expect(all).toHaveLength(6);
    // Six equal columns: Figma's 38px squares with 8px gaps at 268px across, narrower when the popup is.
    expect(all[0].parentElement).toHaveClass("grid", "grid-cols-6", "w-full", "gap-2");
    expect(all[0].parentElement?.parentElement).toHaveClass("w-full", "max-w-[268px]");
    for (const box of all) expect(box).toHaveClass("aspect-square");
  });

  it("switches to Figma's web OTP popup from 1024px up", async () => {
    const dialog = await reachOtp();
    // Figma's web OTP popup is 373px tall with its content centred in it.
    expect(dialog).toHaveClass("lg:font-[family-name:var(--dc-text)]", "lg:min-h-[373px]", "lg:flex", "lg:flex-col", "lg:justify-center");
    expect(screen.getByRole("heading", { name: "Verify OTP" })).toHaveClass("lg:leading-[25.2px]");
    expect(screen.getByText(/sent a 6-digit code/)).toHaveClass("lg:font-[family-name:var(--dc-sans)]", "lg:text-xs");
    expect(screen.getByRole("button", { name: "Verify" })).toHaveClass("lg:mx-auto", "lg:w-[280px]");
    expect(screen.getByRole("button", { name: "Change number" })).toHaveClass("lg:text-xs", "lg:leading-[14.4px]");
  });

  it("opens in the same place as the login popup", async () => {
    const dialog = await reachOtp();
    expect(dialog.style.getPropertyValue("--dc-top")).toContain("calc(100% - 589px)");
  });

  it("goes back to the form with the details kept when changing number", async () => {
    await reachOtp();
    await user.click(screen.getByRole("button", { name: "Change number" }));
    expect(screen.getByLabelText("Your mobile number")).toHaveValue("9876543210");
    expect(screen.getByLabelText("your email ID")).toHaveValue("aanya@example.com");
    expect(screen.getByRole("checkbox")).toBeChecked();
  });
});
