"use client";

import { useState, type FormEvent } from "react";

import { PillButton } from "@/components/campaign/ui";
import { ADMIN_API, ADMIN_HOME } from "@/lib/campaign/admin";

const FIELD =
  "h-12 w-full rounded-[14px] border border-[#E5E5E5] bg-white px-4 text-base text-[#111111] outline-none placeholder:text-[#B5B5B5] focus:border-[#8A8A8A]";
const CAPTION = "text-xs leading-4 font-semibold text-black";

/** The campaign admin's own sign-in, with its own accounts; PrintFlow logins do not work here. */
export function AdminLogin() {
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!userId.trim() || !password) {
      setError("Enter your user ID and password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${ADMIN_API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: userId.trim(), password }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(typeof data?.detail === "string" ? data.detail : "Sign-in failed. Please try again.");
        return;
      }
      window.location.assign(ADMIN_HOME);
    } catch {
      setError("Can’t reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex w-full flex-col gap-5">
      <label className="flex flex-col gap-2">
        <span className={CAPTION}>User ID</span>
        <input
          className={FIELD}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="Your user ID"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
        />
      </label>
      <div className="flex flex-col gap-2">
        <label htmlFor="admin-password" className={CAPTION}>
          Password
        </label>
        <div className="relative">
          <input
            id="admin-password"
            type={showPassword ? "text" : "password"}
            className={`${FIELD} pr-20`}
            autoComplete="current-password"
            placeholder="Your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="button"
            onClick={() => setShowPassword((shown) => !shown)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute inset-y-0 right-1 my-auto h-9 rounded-full px-3 text-xs font-semibold text-black underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-black"
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-xs leading-4 font-medium text-[#F40009]">
          {error}
        </p>
      )}
      <PillButton type="submit" busy={busy}>
        Sign in
      </PillButton>
    </form>
  );
}
