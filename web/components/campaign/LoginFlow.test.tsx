import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CampaignServerError, MOCK_OTP, createMockCampaignApi, type CampaignApi } from "@/lib/campaign/api";

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
    expect(screen.getByRole("dialog", { name: "Login" }).style.top).toContain("calc(100% - 589px)");
  });

  it("sets both inputs in TCCC-UnityHeadline Light, as Figma does", () => {
    renderFlow();
    for (const input of [screen.getByLabelText("Your mobile number"), screen.getByLabelText("your email ID")]) {
      expect(input).toHaveClass("font-[family-name:var(--dc-headline)]", "font-light");
    }
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

  it("explains a wrong code and clears the boxes for another try", async () => {
    await reachOtp();
    await user.type(codeInput(), "000000");
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/doesn.t match/i);
    expect(codeInput()).toHaveValue("");
    expect(onVerified).not.toHaveBeenCalled();
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
    expect(screen.queryByRole("button", { name: "Resend code" })).not.toBeInTheDocument();

    // Time passes as a whole, like a backgrounded tab whose timers were throttled.
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    const sendOtp = vi.spyOn(api, "sendOtp");
    await user.click(screen.getByRole("button", { name: "Resend code" }));
    expect(sendOtp).toHaveBeenCalledWith("9876543210", "aanya@example.com");
    expect(await screen.findByText(/new code is on its way/i)).toBeInTheDocument();
    expect(screen.getByText("00:30")).toBeInTheDocument();
  });

  it("opens in the same place as the login popup", async () => {
    const dialog = await reachOtp();
    expect(dialog.style.top).toContain("calc(100% - 589px)");
  });

  it("goes back to the form with the details kept when changing number", async () => {
    await reachOtp();
    await user.click(screen.getByRole("button", { name: "Change number" }));
    expect(screen.getByLabelText("Your mobile number")).toHaveValue("9876543210");
    expect(screen.getByLabelText("your email ID")).toHaveValue("aanya@example.com");
    expect(screen.getByRole("checkbox")).toBeChecked();
  });
});
