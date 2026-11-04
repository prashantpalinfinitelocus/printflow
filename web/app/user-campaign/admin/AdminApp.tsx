"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

import logo from "@/app/user-campaign/_assets/logo.svg";
import { adminGet, adminPost, LOGIN_PATH, todayInIndia } from "@/lib/campaign/admin";
import { IMAGE_QUALITY } from "@/lib/campaign/imageQuality";

import { CampaignWinners } from "./CampaignWinners";

/**
 * The campaign admin, behind its own sign-in. The session is an httpOnly cookie only the
 * admin API route receives, so the page asks that route who is signed in; a signed-out
 * visitor is sent to the campaign admin login by the API client.
 */
export function AdminApp() {
  const [admin, setAdmin] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    adminGet<{ username: string }>("/auth/me")
      .then((me) => setAdmin(me.username))
      .catch(() => {});
  }, []);

  async function signOut() {
    setSigningOut(true);
    await adminPost("/auth/logout").catch(() => {});
    window.location.assign(LOGIN_PATH);
  }

  return (
    <div className="flex min-h-dvh w-full flex-col bg-white text-[#494949]">
      <header className="flex h-[72px] w-full items-center justify-between gap-4 px-6 lg:h-[100px] lg:px-10">
        <Image quality={IMAGE_QUALITY} src={logo} alt="Diet Coke" className="translate-x-[3.3%] translate-y-[1.9%] scale-[0.8626] h-10 w-[90px] object-contain lg:h-[49.8px] lg:w-28" />
        {admin && (
          <div className="flex items-center gap-3">
            <p className="hidden text-right text-xs leading-4 sm:block">
              <span className="block text-[10px] font-semibold tracking-[1.6px] text-[#8A8A8A] uppercase">Signed in</span>
              <span className="font-semibold text-black">{admin}</span>
            </p>
            <button
              onClick={signOut}
              disabled={signingOut}
              className="inline-flex h-9 items-center rounded-full border border-black px-4 text-xs font-semibold text-black disabled:opacity-50"
            >
              Sign out
            </button>
          </div>
        )}
      </header>
      <main className="flex-1 px-6 pb-16 lg:px-10">
        {admin ? (
          <>
            <div className="mb-8 flex flex-col gap-2">
              <p className="text-[10px] leading-3 font-semibold tracking-[1.6px] text-[#F40009] uppercase lg:text-xs lg:leading-4">
                Diet Coke &nbsp;·&nbsp; Campaign admin
              </p>
              <h1 className="font-[family-name:var(--dc-serif)] text-[32px] leading-10 text-[#F40009] lg:text-[48px] lg:leading-[56px]">
                Daily winners
              </h1>
              <p className="max-w-2xl text-sm leading-[22px]">
                Each day’s lucky draw runs after entries close at 10 PM IST. Generate the print-ready TIFFs from each
                design’s PSD, then download the sheet of winners with a link to every TIFF.
              </p>
            </div>
            {/* Rendered only in the browser, after the sign-in check, so "today" is really today. */}
            <CampaignWinners initialDay={todayInIndia()} />
          </>
        ) : (
          <p className="mt-16 text-center text-sm text-[#8A8A8A]">Checking your sign-in…</p>
        )}
      </main>
    </div>
  );
}
