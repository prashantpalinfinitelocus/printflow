"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { FieldError, Modal, PillButton } from "@/components/campaign/ui";
import { failureReason, track, useTrackOnce } from "@/lib/campaign/analytics";
import { CampaignError, campaignApi, errorMessage, type CampaignApi, type Session } from "@/lib/campaign/api";
import { isValidEmail, isValidPhone } from "@/lib/campaign/text";

const OTP_LENGTH = 6;
const TECH_ERROR = "Something went wrong on our side. Please try again.";

/**
 * Digits of the 10-digit national number. A pasted or autofilled "+91 98765 43210"
 * or "098765 43210" would otherwise be cut to a different, valid-looking number.
 */
function toNationalNumber(input: string) {
  let digits = input.replace(/\D/g, "");
  if (digits.length > 10 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length > 10 && digits.startsWith("0")) digits = digits.slice(1);
  return digits.slice(0, 10);
}

/** Figma: typed text in TCCC-UnityText Regular, the placeholder in UnityHeadline Light grey. */
const INPUT_TEXT =
  "font-[family-name:var(--dc-text)] text-xs leading-[14.4px] font-normal outline-none lg:text-sm placeholder:font-[family-name:var(--dc-headline)] placeholder:font-light placeholder:text-[#8A8A8A]";

const LABEL =
  "font-[family-name:var(--dc-headline)] text-xs leading-[14px] font-bold lg:font-[family-name:var(--dc-text)] lg:leading-[14.4px]";

const formatPhone = (phone: string) => `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`;

const formatCountdown = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

/** Login popup (mobile + email + T&C), then the OTP popup — Figma 243:1173 and 243:1241. */
export function LoginFlow({
  api = campaignApi,
  onClose,
  onVerified,
}: {
  api?: CampaignApi;
  onClose: () => void;
  onVerified: (s: Session) => void;
}) {
  const [step, setStep] = useState<"details" | "otp">("details");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  // Held here, not in DetailsModal, so "Change number" doesn't untick it.
  const [agreed, setAgreed] = useState(false);
  const [resendAfter, setResendAfter] = useState(0);

  if (step === "details") {
    return (
      <DetailsModal
        api={api}
        phone={phone}
        email={email}
        agreed={agreed}
        onPhone={setPhone}
        onEmail={setEmail}
        onAgreed={setAgreed}
        onClose={onClose}
        onSent={(after) => {
          setResendAfter(after);
          setStep("otp");
        }}
      />
    );
  }
  return (
    <OtpModal
      api={api}
      phone={phone}
      email={email.trim()}
      initialResendAfter={resendAfter}
      onClose={onClose}
      onChangeNumber={() => setStep("details")}
      onVerified={onVerified}
    />
  );
}

function DetailsModal({
  api,
  phone,
  email,
  agreed,
  onPhone,
  onEmail,
  onAgreed,
  onClose,
  onSent,
}: {
  api: CampaignApi;
  phone: string;
  email: string;
  agreed: boolean;
  onPhone: (phone: string) => void;
  onEmail: (email: string) => void;
  onAgreed: (agreed: boolean) => void;
  onClose: () => void;
  onSent: (resendAfter: number) => void;
}) {
  const [errors, setErrors] = useState<{ phone?: string; email?: string; terms?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  useTrackOnce("login_screen_viewed");

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next = {
      phone: isValidPhone(phone) ? undefined : "Enter a valid mobile number",
      email: isValidEmail(email) ? undefined : "Enter a valid email address",
      terms: agreed ? undefined : "Please agree to the terms to continue.",
    };
    setErrors(next);
    if (next.phone || next.email || next.terms) return;

    setBusy(true);
    try {
      const { resendAfter } = await api.sendOtp(phone, email.trim());
      track("otp_requested");
      onSent(resendAfter);
    } catch (err) {
      track("otp_request_failed", { failure_reason: failureReason(err) });
      setErrors({ form: errorMessage(err, TECH_ERROR) });
      setBusy(false);
    }
  }

  return (
    // Figma 518:6616, and the web popup in 518:7053.
    <Modal onClose={onClose} cardClassName="lg:!px-8">
      {(titleId) => (
        <form onSubmit={submit} noValidate className="flex flex-col gap-4 lg:gap-6">
          <h2
            id={titleId}
            className="text-center font-[family-name:var(--dc-serif)] text-2xl leading-[33px] text-black lg:text-[28px] lg:leading-[38px]"
          >
            Login
          </h2>

          <div className="flex flex-col gap-2">
            <label htmlFor="dc-phone" className={LABEL}>
              Your mobile number
            </label>
            {/* Figma keeps this border grey on a phone error; only the email field turns red. */}
            <div className="flex h-12 items-center gap-2.5 rounded-lg border border-[#E5E5E5] bg-white px-4 focus-within:border-black">
              <span className="font-[family-name:var(--dc-headline)] text-xs leading-[14.4px] font-bold lg:font-[family-name:var(--dc-text)]">
                +91
              </span>
              <span className="h-5 w-px bg-[#E5E5E5]" aria-hidden="true" />
              <input
                id="dc-phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                placeholder="10-digit mobile number"
                value={phone}
                onChange={(e) => onPhone(toNationalNumber(e.target.value))}
                aria-invalid={Boolean(errors.phone)}
                className={`min-w-0 flex-1 bg-transparent ${INPUT_TEXT} lg:placeholder:font-[family-name:var(--dc-text)] lg:placeholder:font-normal`}
              />
            </div>
            <FieldError>{errors.phone}</FieldError>
          </div>

          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <label htmlFor="dc-email" className={LABEL}>
                <span className="lg:capitalize">Your email ID</span>
              </label>
              <input
                id="dc-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => onEmail(e.target.value)}
                aria-invalid={Boolean(errors.email)}
                className={`h-12 rounded-lg bg-white px-4 ${INPUT_TEXT} focus:border-black ${
                  errors.email ? "border border-[#F40009]" : "border-[0.5px] border-[#E5E5E5]"
                }`}
              />
              <FieldError>{errors.email}</FieldError>
              <label className="flex cursor-pointer items-center gap-1 text-[10px] leading-3 lg:text-[11px] lg:leading-[13px]">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => onAgreed(e.target.checked)}
                  aria-invalid={Boolean(errors.terms)}
                  className="m-0.5 h-3 w-3 accent-[#1C1B1F]"
                />
                <span>
                  I agree to Diet Coke’s <a href="/user-campaign/terms">terms of usage</a>
                </span>
              </label>
              <FieldError>{errors.terms}</FieldError>
            </div>

            <div className="flex flex-col gap-2">
              <FieldError>{errors.form}</FieldError>
              <PillButton type="submit" busy={busy} className="lg:mx-auto lg:h-14 lg:w-[280px] lg:rounded-[26px] lg:text-base lg:leading-[19.2px]">
                Submit
              </PillButton>
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}

function OtpModal({
  api,
  phone,
  email,
  initialResendAfter,
  onClose,
  onChangeNumber,
  onVerified,
}: {
  api: CampaignApi;
  phone: string;
  email: string;
  initialResendAfter: number;
  onClose: () => void;
  onChangeNumber: () => void;
  onVerified: (s: Session) => void;
}) {
  const [code, setCode] = useState("");
  // "wrong" and "expired" have their own Figma states (346:2, 353:2); anything else is a message.
  const [error, setError] = useState<"wrong" | "expired" | string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  // Count down to a fixed deadline rather than counting ticks: phones throttle
  // timers while the user is off reading the SMS, and a tick count would lag.
  const [resendAt, setResendAt] = useState(() => Date.now() + initialResendAfter * 1000);
  const [now, setNow] = useState(() => Date.now());
  const secondsLeft = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const inputRef = useRef<HTMLInputElement>(null);
  const resendRef = useRef<HTMLButtonElement>(null);
  const wasExpired = useRef(false);
  const wrong = error === "wrong";
  const expired = error === "expired";

  // Expiry disables the input, so focus moves to "Resend OTP"; once a new code is sent it goes back to the boxes.
  useEffect(() => {
    if (expired) resendRef.current?.focus();
    else if (wasExpired.current) inputRef.current?.focus();
    wasExpired.current = expired;
  }, [expired]);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [secondsLeft]);

  useEffect(() => inputRef.current?.focus(), []);

  function onType(input: HTMLInputElement) {
    let value = input.value;
    // After a wrong code the old digits stay on show: typing starts a fresh code with what was
    // just entered (wherever the cursor was), and deleting clears it.
    if (wrong) {
      const added = value.length - code.length;
      const end = input.selectionStart ?? value.length;
      value = added > 0 ? value.slice(end - added, end) : "";
    }
    setCode(value.replace(/\D/g, "").slice(0, OTP_LENGTH));
    setError(null);
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (code.length !== OTP_LENGTH) {
      setError(`Enter the ${OTP_LENGTH}-digit code.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const session = await api.verifyOtp(phone, email, code);
      track("login", { method: "otp" });
      track("email_capture_completed");
      onVerified(session);
    } catch (err) {
      track("login_failed", { failure_reason: failureReason(err) });
      const kind = err instanceof CampaignError ? err.code : null;
      setError(kind === "OTP_WRONG" ? "wrong" : kind === "OTP_EXPIRED" ? "expired" : errorMessage(err, TECH_ERROR));
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  async function resend() {
    setResending(true);
    try {
      const { resendAfter } = await api.sendOtp(phone, email);
      track("otp_requested");
      setResendAt(Date.now() + resendAfter * 1000);
      setNow(Date.now());
      setCode("");
      setError(null);
    } catch (err) {
      track("otp_request_failed", { failure_reason: failureReason(err) });
      setError(errorMessage(err, TECH_ERROR));
    } finally {
      setResending(false);
    }
  }

  const active = Math.min(code.length, OTP_LENGTH - 1);
  const message = wrong ? "Incorrect code. Please try again." : expired ? "This code has expired." : error;
  // Figma's normal state spaces the groups 20px apart with the countdown under the code; every other state uses 16px.
  const counting = !wrong && !expired && secondsLeft > 0;
  const canResend = !wrong && !expired && secondsLeft <= 0;

  return (
    // Figma 518:6658, and the web popup in 518:7026.
    <Modal onClose={onClose} cardClassName="font-[family-name:var(--dc-sans)] lg:font-[family-name:var(--dc-text)]">
      {(titleId) => (
        <form onSubmit={verify} noValidate className={`flex flex-col lg:gap-6 ${counting ? "gap-5" : "gap-4"}`}>
          <div className="flex flex-col gap-4">
            <h2 id={titleId} className="text-center font-[family-name:var(--dc-serif)] text-2xl leading-[33px] text-black lg:text-[28px] lg:leading-[38px]">
              Verify OTP
            </h2>
            <p className="text-center text-[13px] leading-5 text-[#8A8A8A] lg:font-[family-name:var(--dc-sans)] lg:text-xs">
              We’ve sent a {OTP_LENGTH}-digit code to
              <br />
              <span className="font-semibold text-black">{formatPhone(phone)}</span>
            </p>
          </div>

          {/* Figma "OTP Field": the error line sits 8px under the boxes, as wide as they are. */}
          <div className="mx-auto flex w-full max-w-[268px] flex-col gap-2">
            {/* One real input under six drawn boxes keeps paste and SMS autofill working. */}
            <div className="relative grid w-full grid-cols-6 gap-2">
              {Array.from({ length: OTP_LENGTH }, (_, i) => {
                const digit = code[i];
                const isActive = !wrong && !expired && i === active && code.length < OTP_LENGTH;
                const look = expired
                  ? "border border-[#E5E5E5] bg-[#F7F7F7] font-normal text-[#8A8A8A]"
                  : wrong
                    ? "border-[1.5px] border-[#F40009] bg-white font-normal"
                    : isActive
                      ? "border-2 border-black bg-white font-bold"
                      : digit
                        ? "border border-[#8A8A8A] bg-white font-bold"
                        : "border border-[#E5E5E5] bg-white";
                return (
                  <div
                    key={i}
                    data-otp-box
                    aria-hidden="true"
                    className={`flex aspect-square items-center justify-center rounded-lg text-xl leading-[24.4px] ${look}`}
                  >
                    {digit ?? (isActive && <span className="h-[22px] w-0.5 animate-pulse rounded-full bg-black" />)}
                  </div>
                );
              })}
              <input
                ref={inputRef}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                aria-label={`${OTP_LENGTH}-digit code`}
                value={code}
                disabled={expired}
                onChange={(e) => onType(e.target)}
                className="absolute inset-0 h-full w-full cursor-text text-transparent caret-transparent opacity-0 disabled:cursor-default"
              />
            </div>
            <FieldError className="justify-center font-[family-name:var(--dc-text)] font-semibold lg:justify-start">
              {message}
            </FieldError>
            {canResend && (
              <p className="text-center text-xs leading-[14px] text-[#8A8A8A]">
                Didn’t get the code?{" "}
                <button
                  type="button"
                  onClick={resend}
                  disabled={resending}
                  className="font-[family-name:var(--dc-text)] font-bold text-[#F40009] underline underline-offset-2 disabled:opacity-50"
                >
                  Resend OTP
                </button>
              </p>
            )}
          </div>

          <div className="flex flex-col gap-4">
            {expired && (
              <p className="text-center font-[family-name:var(--dc-text)] text-xs leading-[14.4px] text-[#8A8A8A]">
                Request a new code to continue.
              </p>
            )}
            {counting && (
              <p className="text-center text-xs leading-[15px] text-[#8A8A8A]">
                Didn’t get the code?{" "}
                <span className="font-semibold text-black">
                  Resend in <span className="text-[#F40009] tabular-nums">{formatCountdown(secondsLeft)}</span>
                </span>
              </p>
            )}

            <div className="flex flex-col gap-4">
              {expired ? (
                <PillButton
                  ref={resendRef}
                  type="button"
                  onClick={resend}
                  busy={resending}
                  className="font-[family-name:var(--dc-text)] lg:mx-auto lg:h-14 lg:w-[280px] lg:rounded-[26px] lg:text-base lg:leading-[19.2px]"
                >
                  Resend OTP
                </PillButton>
              ) : (
                // Figma sets the popup in Montserrat but this button in TCCC-UnityText Medium,
                // greyed out (351:75) until there is a code to check.
                <PillButton
                  type="submit"
                  busy={busy}
                  // Greyed out with no code, and for a code the server has just turned down.
                  disabled={!code || wrong}
                  className="font-[family-name:var(--dc-text)] disabled:bg-[#E5E5E5] disabled:text-[#8A8A8A] disabled:opacity-100 lg:mx-auto lg:h-14 lg:w-[280px] lg:rounded-[26px] lg:text-base lg:leading-[19.2px]"
                >
                  Verify
                </PillButton>
              )}
              <button
                type="button"
                onClick={onChangeNumber}
                className={`text-center text-[13px] font-semibold underline underline-offset-2 lg:text-xs lg:leading-[14.4px] ${counting ? "leading-[15.8px]" : "leading-[14px]"}`}
              >
                Change number
              </button>
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}
