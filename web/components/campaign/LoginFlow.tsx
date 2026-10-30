"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { FieldError, Modal, PillButton } from "@/components/campaign/ui";
import { CampaignError, campaignApi, type CampaignApi, type Session } from "@/lib/campaign/api";
import { isValidEmail, isValidPhone } from "@/lib/campaign/text";

const OTP_LENGTH = 6;
const TECH_ERROR = "Something went wrong on our side. Please try again.";

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
  const [resendAfter, setResendAfter] = useState(0);

  if (step === "details") {
    return (
      <DetailsModal
        api={api}
        phone={phone}
        email={email}
        onPhone={setPhone}
        onEmail={setEmail}
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
  onPhone,
  onEmail,
  onClose,
  onSent,
}: {
  api: CampaignApi;
  phone: string;
  email: string;
  onPhone: (phone: string) => void;
  onEmail: (email: string) => void;
  onClose: () => void;
  onSent: (resendAfter: number) => void;
}) {
  const [agreed, setAgreed] = useState(false);
  const [errors, setErrors] = useState<{ phone?: string; email?: string; terms?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next = {
      phone: isValidPhone(phone) ? undefined : "Enter a valid 10-digit mobile number.",
      email: isValidEmail(email) ? undefined : "Enter a valid email ID — that’s where we’ll reach you if you win.",
      terms: agreed ? undefined : "Please agree to the terms to continue.",
    };
    setErrors(next);
    if (next.phone || next.email || next.terms) return;

    setBusy(true);
    try {
      const { resendAfter } = await api.sendOtp(phone, email.trim());
      onSent(resendAfter);
    } catch {
      setErrors({ form: TECH_ERROR });
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      {(titleId) => (
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <h2 id={titleId} className="text-center text-[21px] leading-[1.2] font-bold">
            Login
          </h2>

          <div className="flex flex-col gap-2">
            <label htmlFor="dc-phone" className="text-xs font-bold">
              Your mobile number
            </label>
            <div
              className={`flex h-12 items-center gap-2.5 rounded-lg border bg-white px-4 focus-within:border-black ${
                errors.phone ? "border-[#F40009]" : "border-[#E5E5E5]"
              }`}
            >
              <span className="text-xs font-bold">+91</span>
              <span className="h-5 w-px bg-[#E5E5E5]" aria-hidden="true" />
              {/* 16px text: iOS zooms the page into any smaller input on focus. */}
              <input
                id="dc-phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                placeholder="10-digit mobile number"
                value={phone}
                onChange={(e) => onPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                aria-invalid={Boolean(errors.phone)}
                className="min-w-0 flex-1 bg-transparent text-base font-light outline-none placeholder:text-[#8A8A8A]"
              />
            </div>
            <FieldError>{errors.phone}</FieldError>
          </div>

          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <label htmlFor="dc-email" className="text-xs font-bold">
                your email ID
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
                className={`h-12 rounded-lg border bg-white px-4 text-base font-light outline-none placeholder:text-[#8A8A8A] focus:border-black ${
                  errors.email ? "border-[#F40009]" : "border-[#E5E5E5]"
                }`}
              />
              <FieldError>{errors.email}</FieldError>
              <label className="flex cursor-pointer items-center gap-1 text-[9px] leading-[1.2]">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  aria-invalid={Boolean(errors.terms)}
                  className="h-4 w-4 accent-[#1C1B1F]"
                />
                I Agree to Diet cokes’ terms of usage
              </label>
              <FieldError>{errors.terms}</FieldError>
            </div>

            <div className="flex flex-col gap-2">
              <FieldError>{errors.form}</FieldError>
              <PillButton type="submit" busy={busy}>
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
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  // Count down to a fixed deadline rather than counting ticks: phones throttle
  // timers while the user is off reading the SMS, and a tick count would lag.
  const [resendAt, setResendAt] = useState(() => Date.now() + initialResendAfter * 1000);
  const [now, setNow] = useState(() => Date.now());
  const secondsLeft = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [secondsLeft]);

  useEffect(() => inputRef.current?.focus(), []);

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (code.length !== OTP_LENGTH) {
      setError(`Enter the ${OTP_LENGTH}-digit code.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onVerified(await api.verifyOtp(phone, email, code));
    } catch (err) {
      setError(err instanceof CampaignError ? err.message : TECH_ERROR);
      setCode("");
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  async function resend() {
    setResending(true);
    setError(null);
    try {
      const { resendAfter } = await api.sendOtp(phone, email);
      setResendAt(Date.now() + resendAfter * 1000);
      setNow(Date.now());
      setCode("");
      setNotice("A new code is on its way.");
    } catch {
      setError(TECH_ERROR);
    } finally {
      setResending(false);
    }
  }

  const active = Math.min(code.length, OTP_LENGTH - 1);

  return (
    <Modal onClose={onClose}>
      {(titleId) => (
        <form onSubmit={verify} noValidate className="flex flex-col gap-4">
          <h2 id={titleId} className="text-center text-[21px] leading-[1.2] font-bold">
            Verify OTP
          </h2>
          <p className="text-center text-[13px] leading-5 text-[#8A8A8A]">
            We’ve sent a {OTP_LENGTH}-digit code to
            <br />
            <span className="font-semibold text-black">{formatPhone(phone)}</span>
          </p>

          {/* One real input under six drawn boxes keeps paste and SMS autofill working. */}
          <div className="relative mx-auto flex gap-2">
            {Array.from({ length: OTP_LENGTH }, (_, i) => {
              const digit = code[i];
              const isActive = i === active && code.length < OTP_LENGTH;
              const border = isActive
                ? "border-2 border-black"
                : digit
                  ? "border border-[#8A8A8A]"
                  : error
                    ? "border border-[#F40009]"
                    : "border border-[#E5E5E5]";
              return (
                <div
                  key={i}
                  aria-hidden="true"
                  className={`flex h-[38px] w-[38px] items-center justify-center rounded-lg bg-white text-xl font-bold ${border}`}
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
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH));
                setError(null);
                setNotice(null);
              }}
              className="absolute inset-0 h-full w-full cursor-text text-transparent caret-transparent opacity-0"
            />
          </div>

          <div className="text-center">
            <FieldError>{error}</FieldError>
            {notice && !error && <p className="text-[11px] text-[#8A8A8A]">{notice}</p>}
          </div>

          <p className="text-center text-xs text-[#8A8A8A]">
            Didn’t get the code?{" "}
            {secondsLeft > 0 ? (
              <span className="font-semibold text-black">
                Resend in <span className="text-[#F40009] tabular-nums">{formatCountdown(secondsLeft)}</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={resend}
                disabled={resending}
                className="font-semibold text-black underline underline-offset-2 disabled:opacity-50"
              >
                Resend code
              </button>
            )}
          </p>

          <div className="flex flex-col gap-4">
            <PillButton type="submit" busy={busy}>
              Verify
            </PillButton>
            <button
              type="button"
              onClick={onChangeNumber}
              className="text-center text-[13px] font-semibold underline underline-offset-2"
            >
              Change number
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
