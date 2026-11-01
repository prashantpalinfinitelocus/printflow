"use client";

import Image from "next/image";
import { useCampaignRouter } from "@/lib/campaign/nav";
import { useState } from "react";

import hero from "@/app/user-campaign/_assets/hero.png";
import logo from "@/app/user-campaign/_assets/logo.png";
import webBg from "@/app/user-campaign/_assets/web-bg.jpg";
import webHands from "@/app/user-campaign/_assets/web-hands.png";
import webLandingCan from "@/app/user-campaign/_assets/web-landing-can.png";
import webLandingHands from "@/app/user-campaign/_assets/web-landing-hands.png";
import { ImagePreload } from "@/components/campaign/ImagePreload";
import { LoginFlow } from "@/components/campaign/LoginFlow";
import { PillButton } from "@/components/campaign/ui";
import { IMAGE_QUALITY } from "@/lib/campaign/imageQuality";
import { useCampaign } from "@/lib/campaign/store";


const HERO_SIZES = "120vw";
const HANDS_SIZES = "100vw";
const WEB_HANDS_SIZES = "86vh";
const WEB_CAN_SIZES = "25vh";

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
      <div data-mobile-hero className="min-[481px]:hidden" aria-hidden="true">
        <div className="absolute inset-x-0 top-[-78px] bottom-[141px]">
          <Image quality={IMAGE_QUALITY} src={hero} alt="" fill sizes={HERO_SIZES} className="object-cover" />
        </div>
      </div>
      {/*
        Web (1440 × 900, Figma 369:59): the sunlight photo is 2167 × 1220 from 148px above the top.
        The hands photo is 771 × 1032 at x 149, y −31.5 (its top-left cut just off the screen), and the can, a separate photo, is 218 × 540,
        tilted 9° and centred at (388, 423) between them, behind the fingers. Sized in dvh so both cut
        edges of the hands photo stay off the screen; on a narrow desktop the group slides left rather
        than shrink, its right edge held at 63.89%, clear of the copy.
        Tablets have no Figma design: cropping the phone photo to a wide screen cut the can, so they
        use the same backdrop with the flattened can-in-hands cut-out centred and filling the height
        above the copy, its wrist under the fade; on a narrow tablet its sides run off the screen.
        Each size preloads only its own photos; the images stay lazy, so a hidden one is never fetched.
      */}
      <ImagePreload src={hero} sizes={HERO_SIZES} media="(max-width: 480px)" />
      <ImagePreload src={webBg} sizes="150vw" media="(min-width: 481px)" />
      <ImagePreload src={webHands} sizes={HANDS_SIZES} media="(min-width: 481px) and (max-width: 1023px)" />
      <ImagePreload src={webLandingHands} sizes={WEB_HANDS_SIZES} media="(min-width: 1024px)" />
      <ImagePreload src={webLandingCan} sizes={WEB_CAN_SIZES} media="(min-width: 1024px)" />
      <div data-web-backdrop className="absolute inset-0 hidden min-[481px]:block" aria-hidden="true">
        <div className="absolute top-[-16.44%] left-0 h-[135.56%] w-[150.49%]">
          <Image quality={IMAGE_QUALITY} src={webBg} alt="" fill sizes="150vw" className="object-cover" />
        </div>
        <Image quality={IMAGE_QUALITY}
          data-tablet-hands
          src={webHands}
          alt=""
          sizes={HANDS_SIZES}
          className="absolute top-0 left-1/2 h-[calc(100dvh-200px)] w-auto max-w-none -translate-x-1/2 lg:hidden"
        />
        <div
          data-web-hands
          className="absolute hidden aspect-[896/1200] lg:top-[-3.5dvh] lg:left-[min(10.35%,calc(63.89%-85.67dvh))] lg:block lg:h-[114.67dvh]"
        >
          <div className="absolute top-[17.87%] left-[16.87%] h-[52.33%] w-[28.27%] rotate-[9deg]">
            <Image quality={IMAGE_QUALITY} src={webLandingCan} alt="" fill sizes={WEB_CAN_SIZES} className="object-contain" />
          </div>
          <Image quality={IMAGE_QUALITY} src={webLandingHands} alt="" fill sizes={WEB_HANDS_SIZES} className="object-contain" />
        </div>
      </div>
      {/* Figma "Rectangle 3": 354px tall at the foot, clear until 8% then white by 33.5%. */}
      <div
        data-fade
        className="absolute inset-x-0 bottom-0 h-[356px] bg-[linear-gradient(to_bottom,rgb(255_255_255/0)_28px,#fff_119px)] lg:hidden"
        aria-hidden="true"
      />
      <Image quality={IMAGE_QUALITY}
        src={logo}
        alt="Diet Coke"
        priority
        sizes="90px"
        className="absolute top-4 right-4 h-10 w-[90px] object-contain lg:top-10 lg:right-10 lg:h-[49.8px] lg:w-28"
      />

      {/* On web the copy and the legal links are placed on the screen separately, so this wrapper steps aside. */}
      <div className="relative mt-auto flex flex-col gap-4 px-[max(24px,calc(50%-216px))] pb-[41px] lg:contents">
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
