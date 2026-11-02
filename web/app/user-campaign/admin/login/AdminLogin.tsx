"use client";

import { useState, type FormEvent } from "react";

import { PillButton } from "@/components/campaign/ui";
import { ADMIN_API, ADMIN_HOME } from "@/lib/campaign/admin";

const FIELD =
  "h-12 w-full rounded-[14px] border border-[#E5E5E5] px-4 text-base text-[#111111] outline-none placeholder:text-[#B5B5B5] focus:border-[#8A8A8A]";
const CAPTION = "text-xs leading-4 font-semibold text-black";

/** The campaign admin's own sign-in, with its own accounts; PrintFlow logins do not work here. */
export function AdminLogin() {
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
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
      <label className="flex flex-col gap-2">
        <span className={CAPTION}>Password</span>
        <input
          type="password"
          className={FIELD}
          autoComplete="current-password"
          placeholder="Your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
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
