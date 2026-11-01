"use client";

import Image from "next/image";
import { useCampaignRouter } from "@/lib/campaign/nav";
import { useState } from "react";

import hero from "@/app/user-campaign/_assets/hero.png";
import logo from "@/app/user-campaign/_assets/logo.png";
import webBg from "@/app/user-campaign/_assets/web-bg.jpg";
import webHands from "@/app/user-campaign/_assets/web-hands.png";
import { ImagePreload } from "@/components/campaign/ImagePreload";
import { LoginFlow } from "@/components/campaign/LoginFlow";
import { PillButton } from "@/components/campaign/ui";
import { useCampaign } from "@/lib/campaign/store";


const HERO_SIZES = "(max-width: 480px) 120vw, 576px";

/** On hover or keyboard focus the text darkens to black and a 2px black underline grows out from the middle. */
const LEGAL_LINK =
  "relative transition-colors duration-300 hover:text-black focus-visible:text-black after:absolute after:inset-x-0 after:-bottom-1 after:h-0.5 after:origin-center after:scale-x-0 after:rounded-full after:bg-black after:transition-transform after:duration-300 hover:after:scale-x-100 focus-visible:after:scale-x-100 motion-reduce:transition-none motion-reduce:after:transition-none";

/**
 * Splash screen — Figma 243:1306, and 356:1307 from 1024px up. "Let’s set the vibes" opens login (243:1173).
 * `openLogin` is set for /campaign?login=1, where guarded screens send a visitor without a session.
 */
export function Landing({ openLogin = false }: { openLogin?: boolean }) {
  const router = useCampaignRouter();
  const { ready, session, update } = useCampaign();
  const [loginOpen, setLoginOpen] = useState(openLogin);
  // A logged-in visitor pressing Back onto ?login=1 must not be asked to log in again.
  const showLogin = loginOpen && ready && !session;

  function start() {
    if (session) router.push("/user-campaign/create");
    else setLoginOpen(true);
  }

  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden bg-[#ECEDEF]">
      {/*
        Figma: the photo runs from 78px above the screen to 141px above its foot (401×712 on 402×775).
        Pinning both edges and covering the box keeps that exact on the design size, and on taller
        phones the photo grows instead of ending in a hard edge above the text.
      */}
      <div data-mobile-hero className="lg:hidden" aria-hidden="true">
        <div className="absolute inset-x-0 top-[-78px] bottom-[141px]">
          <Image src={hero} alt="" fill sizes={HERO_SIZES} className="object-cover" />
        </div>
        {/* Figma "Rectangle 3": 354px tall at the foot, clear until 8% then white by 33.5%. */}
        <div className="absolute inset-x-0 bottom-0 h-[356px] bg-[linear-gradient(to_bottom,rgb(255_255_255/0)_28px,#fff_119px)]" />
      </div>
      {/*
        Web (1440 × 900): the sunlight photo is 2167 × 1220 from 148px above the top, and the
        can-in-hands cut-out is 1045px tall at x 82, y −4. Sizes are kept as shares of the screen,
        the cut-out capped by width too so it can't run into the copy on a narrow desktop.
        Each size preloads only its own photos; the images stay lazy, so a hidden one is never fetched.
      */}
      <ImagePreload src={hero} sizes={HERO_SIZES} media="(max-width: 1023px)" />
      <ImagePreload src={webBg} sizes="150vw" media="(min-width: 1024px)" />
      <ImagePreload src={webHands} sizes="60vw" media="(min-width: 1024px)" />
      <div data-web-backdrop className="absolute inset-0 hidden lg:block" aria-hidden="true">
        <div className="absolute top-[-16.44%] left-0 h-[135.56%] w-[150.49%]">
          <Image src={webBg} alt="" fill sizes="150vw" className="object-cover" />
        </div>
        <Image
          src={webHands}
          alt=""
          sizes="60vw"
          className="absolute top-[-0.44%] left-[5.69%] h-[min(116.11dvh,72.57vw)] w-auto max-w-none"
        />
      </div>
      <Image
        src={logo}
        alt="Diet Coke"
        priority
        sizes="90px"
        className="absolute top-4 right-4 h-10 w-[90px] object-contain lg:top-10 lg:right-10 lg:h-[49.8px] lg:w-28"
      />

      {/* On web the copy and the legal links are placed on the screen separately, so this wrapper steps aside. */}
      <div className="relative mt-auto flex flex-col gap-4 px-6 pb-[41px] lg:contents">
        <div data-copy className="flex flex-col gap-6 lg:absolute lg:top-[37%] lg:left-[57.08%] lg:w-[466px] lg:gap-11">
          <div className="flex flex-col gap-2 text-center lg:gap-4">
            <div className="flex flex-col gap-4">
              <p className="text-xs leading-4 font-semibold tracking-[1.44px] text-[#494949] lg:text-base lg:leading-4 lg:tracking-normal">
                Your DC. Your Vibe
              </p>
              <h1 className="font-[family-name:var(--dc-serif)] text-[40px] leading-10 text-[#F40009] lg:leading-[45.6px]">
                Make it <em>yours</em>
              </h1>
            </div>
            <p className="mx-auto max-w-[278px] text-sm leading-[22px] text-[#494949] lg:max-w-none lg:text-base lg:leading-6">
              Custom can, major flex. Only a lucky few <br className="hidden lg:inline" />
              DC Paglus score one!
            </p>
          </div>
          {/* Disabled until the saved session is read, so a fast tap can't open login for a logged-in visitor. */}
          <PillButton
            type="button"
            onClick={start}
            disabled={!ready}
            className="!text-base !leading-[19.2px] lg:mx-auto lg:w-[280px]"
          >
            Let’s set the vibes
          </PillButton>
        </div>
        <nav
          className="flex items-center justify-center gap-4 text-xs leading-[14.4px] text-[#494949] lg:absolute lg:bottom-8 lg:left-[65.28%]"
          aria-label="Legal"
        >
          <a href="/user-campaign/terms" className={LEGAL_LINK}>
            Terms &amp; Conditions
          </a>
          <span className="h-4 w-px bg-[#A4A8AF]" aria-hidden="true" />
          <a href="/user-campaign/privacy" className={LEGAL_LINK}>
            Privacy Policy
          </a>
        </nav>
      </div>

      {showLogin && (
        <LoginFlow
          onClose={() => setLoginOpen(false)}
          onVerified={(s) => {
            update({ session: s });
            router.push("/user-campaign/create");
          }}
        />
      )}
    </main>
  );
}
