"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import hero from "@/app/campaign/_assets/hero.png";
import logo from "@/app/campaign/_assets/logo.png";
import { LoginFlow } from "@/components/campaign/LoginFlow";
import { PillButton } from "@/components/campaign/ui";
import { useCampaign } from "@/lib/campaign/store";


/**
 * Splash screen — Figma 243:1306. "Let’s set the vibes" opens login (243:1173).
 * `openLogin` is set for /campaign?login=1, where guarded screens send a visitor without a session.
 */
export function Landing({ openLogin = false }: { openLogin?: boolean }) {
  const router = useRouter();
  const { ready, session, update } = useCampaign();
  const [loginOpen, setLoginOpen] = useState(openLogin);
  // A logged-in visitor pressing Back onto ?login=1 must not be asked to log in again.
  const showLogin = loginOpen && ready && !session;

  function start() {
    if (session) router.push("/campaign/create");
    else setLoginOpen(true);
  }

  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden bg-[#ECEDEF]">
      {/*
        Figma: the photo runs from 78px above the screen to 141px above its foot (401×712 on 402×775).
        Pinning both edges and covering the box keeps that exact on the design size, and on taller
        phones the photo grows instead of ending in a hard edge above the text.
      */}
      <div className="absolute inset-x-0 top-[-78px] bottom-[141px]" aria-hidden="true">
        <Image src={hero} alt="" fill priority sizes="(max-width: 480px) 120vw, 576px" className="object-cover" />
      </div>
      {/* Figma "Rectangle 3": 354px tall at the foot, clear until 8% then white by 33.5%. */}
      <div
        className="absolute inset-x-0 bottom-0 h-[356px] bg-[linear-gradient(to_bottom,rgb(255_255_255/0)_28px,#fff_119px)]"
        aria-hidden="true"
      />
      <Image
        src={logo}
        alt="Diet Coke"
        priority
        sizes="90px"
        className="absolute top-4 right-4 h-10 w-[90px] object-contain"
      />

      <div className="relative mt-auto flex flex-col gap-4 px-6 pb-[41px]">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2 text-center">
            <div className="flex flex-col gap-4">
              <p className="text-xs leading-4 font-semibold tracking-[1.44px] text-[#494949]">Your DC. Your Vibe</p>
              <h1 className="font-[family-name:var(--dc-serif)] text-[40px] leading-10 text-[#F40009]">
                Make it <em>yours</em>
              </h1>
            </div>
            <p className="mx-auto max-w-[278px] text-sm leading-[22px] text-[#494949]">
              Custom can, major flex. Only a lucky few DC Paglus score one!
            </p>
          </div>
          {/* Disabled until the saved session is read, so a fast tap can't open login for a logged-in visitor. */}
          <PillButton type="button" onClick={start} disabled={!ready} className="!text-base !leading-[19.2px]">
            Let’s set the vibes
          </PillButton>
        </div>
        <nav className="flex items-center justify-center gap-4 text-xs leading-[14.4px] text-[#494949]" aria-label="Legal">
          <Link href="/campaign/terms">Terms &amp; Conditions</Link>
          <span className="h-4 w-px bg-[#A4A8AF]" aria-hidden="true" />
          <Link href="/campaign/privacy">Privacy Policy</Link>
        </nav>
      </div>

      {showLogin && (
        <LoginFlow
          onClose={() => setLoginOpen(false)}
          onVerified={(s) => {
            update({ session: s });
            router.push("/campaign/create");
          }}
        />
      )}
    </main>
  );
}
