"use client";

import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import hero from "@/app/campaign/_assets/hero.png";
import logo from "@/app/campaign/_assets/logo.png";
import { LoginFlow } from "@/components/campaign/LoginFlow";
import { PillButton } from "@/components/campaign/ui";
import { useCampaign } from "@/lib/campaign/store";

/* Not supplied yet — brand/legal to provide the final URLs (PRD 22). */
const TERMS_URL = "#";
const PRIVACY_URL = "#";

/** Splash screen — Figma 243:1306. "Let’s set the vibes" opens login (243:1173). */
export default function LandingPage() {
  // useSearchParams needs a Suspense boundary for the page to prerender.
  return (
    <Suspense>
      <Landing />
    </Suspense>
  );
}

function Landing() {
  const router = useRouter();
  const { ready, session, update } = useCampaign();
  // /campaign?login=1 is where the customiser sends a visitor with no session.
  const [loginOpen, setLoginOpen] = useState(useSearchParams().get("login") === "1");

  function start() {
    if (session) router.push("/campaign/create");
    else setLoginOpen(true);
  }

  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden bg-[#ECEDEF]">
      {/* Hero bleeds 78px above the fold in the design; margin-top % scales with width. */}
      <div className="absolute inset-x-0 top-0 mt-[-19.4%]" aria-hidden="true">
        <Image src={hero} alt="" priority sizes="(max-width: 430px) 100vw, 430px" className="h-auto w-full" />
      </div>
      <div
        className="absolute inset-x-0 bottom-0 h-[46%] bg-gradient-to-b from-white/0 to-white to-45%"
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
            <p className="text-xs leading-4 font-semibold tracking-[0.12em] text-[#494949] uppercase">
              Your DC. Your Vibe
            </p>
            <h1 className="font-[family-name:var(--dc-serif)] text-[40px] leading-10 text-[#F40009]">
              Make it <em>yours.</em>
            </h1>
            <p className="mx-auto max-w-[300px] text-base leading-6 text-[#494949]">
              Custom can, major flex. Only a lucky few DC Paglus score one!
            </p>
          </div>
          {/* Disabled until the saved session is read, so a fast tap can't open login for a logged-in visitor. */}
          <PillButton type="button" onClick={start} disabled={!ready} className="!text-base">
            Let’s set the vibes
          </PillButton>
        </div>
        <nav className="flex items-center justify-center gap-4 text-xs text-[#494949]" aria-label="Legal">
          <a href={TERMS_URL}>Terms &amp; Conditions</a>
          <span className="h-4 w-px bg-[#A4A8AF]" aria-hidden="true" />
          <a href={PRIVACY_URL}>Privacy Policy</a>
        </nav>
      </div>

      {loginOpen && (
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
