"use client";

import Image from "next/image";
import { useCampaignRouter } from "@/lib/campaign/nav";
import { useState } from "react";

import landingCan from "@/app/user-campaign/_assets/landing-can.png";
import logo from "@/app/user-campaign/_assets/logo.png";
import mobileBg from "@/app/user-campaign/_assets/mobile-bg.png";
import webBg from "@/app/user-campaign/_assets/web-landing-bg.png";
import { ImagePreload } from "@/components/campaign/ImagePreload";
import { LoginFlow } from "@/components/campaign/LoginFlow";
import { PillButton } from "@/components/campaign/ui";
import { track, useTrackOnce } from "@/lib/campaign/analytics";
import { IMAGE_QUALITY, LOGO_SIZES } from "@/lib/campaign/imageQuality";
import { useCampaign } from "@/lib/campaign/store";

const CAN_SIZES = "(min-width: 1024px) 45vh, 100vw";

/** On hover or keyboard focus the text darkens to black and a 2px black underline grows out from the middle. */
const LEGAL_LINK =
  "relative transition-colors duration-300 hover:text-black focus-visible:text-black after:absolute after:inset-x-0 after:-bottom-1 after:h-0.5 after:origin-center after:scale-x-0 after:rounded-full after:bg-black after:transition-transform after:duration-300 hover:after:scale-x-100 focus-visible:after:scale-x-100 motion-reduce:transition-none motion-reduce:after:transition-none";

/**
 * Splash screen — Figma 518:6571, and 518:7085 from 1024px up. "Be on the can!" opens login.
 * `openLogin` is set for /campaign?login=1, where guarded screens send a visitor without a session.
 */
export function Landing({ openLogin = false }: { openLogin?: boolean }) {
  const router = useCampaignRouter();
  const { ready, session, update } = useCampaign();
  const [loginOpen, setLoginOpen] = useState(openLogin);
  // A logged-in visitor pressing Back onto ?login=1 must not be asked to log in again.
  const showLogin = loginOpen && ready && !session;
  useTrackOnce("campaign_landing_viewed");

  function start() {
    track("campaign_cta_clicked");
    if (session) router.push("/user-campaign/create");
    else setLoginOpen(true);
  }

  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden bg-[#ECEDEF]">
      {/* Each size preloads only its own photo; the images stay lazy, so a hidden one is never fetched. */}
      <ImagePreload src={mobileBg} sizes="100vw" media="(max-width: 1023px)" />
      <ImagePreload src={webBg} sizes="100vw" media="(min-width: 1024px)" />
      {/* Figma's 874px phone frame starts with a 99px mocked browser bar, so the photo starts that far above the screen. */}
      <div data-mobile-bg className="absolute inset-x-0 top-[-99px] bottom-0 lg:hidden" aria-hidden="true">
        <Image quality={IMAGE_QUALITY} src={mobileBg} alt="" fill placeholder="blur" sizes="100vw" className="object-cover" />
      </div>
      <div data-web-bg className="absolute inset-0 hidden lg:block" aria-hidden="true">
        <Image quality={IMAGE_QUALITY} src={webBg} alt="" fill placeholder="blur" sizes="100vw" className="object-cover" />
      </div>
      {/*
        Figma: 170×423 from 168px down on the 775px screen, filling the space above the button. Web: 262×651,
        tilted 17.91° clockwise and centred at (501.5, 439) on the 1440×900 screen, sized in dvh so it stays clear of the copy.
      */}
      <div
        data-can
        className="absolute top-[168px] left-1/2 aspect-[170/423] h-[calc(100dvh-352px)] -translate-x-1/2 lg:top-[48.78%] lg:left-[34.83%] lg:h-[72.35dvh] lg:-translate-y-1/2 lg:rotate-[17.91deg]"
      >
        <Image quality={IMAGE_QUALITY} src={landingCan} alt="" fill priority placeholder="blur" sizes={CAN_SIZES} className="object-contain" />
      </div>
      <div
        data-shadow
        className="absolute top-[calc(100dvh-172px)] left-1/2 h-[15px] w-[172px] -translate-x-1/2 rounded-[50%] bg-black/14 blur-[4px] lg:top-[90.22%] lg:left-[30.08%] lg:h-[17px] lg:w-[257px]"
        aria-hidden="true"
      />
      <Image quality={IMAGE_QUALITY}
        src={logo}
        alt="Diet Coke"
        priority
        sizes={LOGO_SIZES}
        className="absolute top-4 right-4 h-[27px] w-[60px] object-contain lg:top-10 lg:right-auto lg:left-10"
      />

      {/* On web the headline, button and legal links are placed on the screen separately, so the wrapper steps aside. */}
      <h1
        data-headline
        className="relative mx-auto mt-[43px] flex w-full max-w-[354px] flex-col text-center font-[family-name:var(--dc-serif)] text-[#F40009] lg:absolute lg:top-[37.28%] lg:left-[59.03%] lg:mt-0 lg:w-[401px] lg:max-w-none"
      >
        <span className="text-2xl leading-10 lg:text-4xl lg:leading-[52px]">
          Make it <em>official.</em>
        </span>{" "}
        <span className="text-[40px] leading-10 lg:text-[56px] lg:leading-16">
          Make it <em>yours!</em>
        </span>
      </h1>
      <div data-foot className="relative mt-auto flex flex-col gap-4 px-[max(24px,calc(50%-177px))] pb-[47px] lg:contents">
        {/* Disabled until the saved session is read, so a fast tap can't open login for a logged-in visitor; it never looks dimmed. */}
        <PillButton
          type="button"
          onClick={start}
          disabled={!ready}
          className="disabled:opacity-100 lg:absolute lg:top-[56.39%] lg:left-[calc(59.03%+37.5px)] lg:h-14 lg:w-[326px] lg:rounded-[28px] lg:text-base lg:leading-[19.2px]"
        >
          Be on the can!
        </PillButton>
        <nav
          className="flex items-center justify-center gap-4 text-xs leading-[14.4px] text-[#494949] lg:absolute lg:right-8 lg:bottom-8"
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
