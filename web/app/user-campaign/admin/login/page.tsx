import type { Metadata } from "next";
import Image from "next/image";

import logo from "@/app/user-campaign/_assets/logo.png";
import webBg from "@/app/user-campaign/_assets/web-bg.jpg";
import webLandingCan from "@/app/user-campaign/_assets/web-landing-can.png";
import webLandingHands from "@/app/user-campaign/_assets/web-landing-hands.png";
import { IMAGE_QUALITY } from "@/lib/campaign/imageQuality";

import { AdminLogin } from "./AdminLogin";

export const metadata: Metadata = { title: "Campaign admin sign in", robots: { index: false, follow: false } };

/**
 * The campaign admin's sign-in, dressed like the web landing (Figma 369:59): the sunlight
 * backdrop over the whole page, the can dropping into place and then drifting slowly between the hands on the left from
 * 1024px, the logo in the corner, and a serif headline with the form where the landing has its
 * copy. Phones get the backdrop, the logo and the form.
 */
export default function AdminLoginPage() {
  return (
    <main className="relative flex min-h-dvh w-full flex-col items-center justify-center overflow-hidden bg-[#ECEDEF] px-6 pt-28 pb-12 text-[#494949] lg:p-0">
      <div data-backdrop className="absolute inset-0" aria-hidden="true">
        <div className="absolute top-[-16.44%] left-0 h-[135.56%] w-[150.49%]">
          <Image quality={IMAGE_QUALITY} src={webBg} alt="" fill priority sizes="150vw" className="object-cover" />
        </div>
        {/* The landing's placement: both cut edges of the hands stay off the screen at any laptop height. */}
        <div
          data-hands
          className="absolute hidden aspect-[896/1200] lg:top-[-3.5dvh] lg:left-[min(10.35%,calc(63.89%-85.67dvh))] lg:block lg:h-[114.67dvh]"
        >
          <div
            data-can
            className="animate-can-float absolute top-[17.87%] left-[16.87%] h-[52.33%] w-[28.27%] rotate-[9deg] motion-reduce:animate-none"
          >
            <Image quality={IMAGE_QUALITY} src={webLandingCan} alt="" fill sizes="25vh" className="object-contain" />
          </div>
          <Image quality={IMAGE_QUALITY} src={webLandingHands} alt="" fill sizes="86vh" className="object-contain" />
        </div>
      </div>

      <Image
        quality={IMAGE_QUALITY}
        src={logo}
        alt="Diet Coke"
        priority
        sizes="112px"
        className="absolute top-8 left-1/2 h-10 w-[90px] -translate-x-1/2 object-contain lg:top-10 lg:right-10 lg:left-auto lg:h-[49.8px] lg:w-28 lg:translate-x-0"
      />

      <div
        data-panel
        className="relative flex w-full max-w-[400px] flex-col gap-8 lg:absolute lg:top-1/2 lg:left-[57.08%] lg:w-[466px] lg:max-w-[min(466px,calc(100vw-57.08%-40px))] lg:-translate-y-1/2"
      >
        <div className="flex flex-col gap-3">
          <h1 className="font-[family-name:var(--dc-serif)] text-[40px] leading-[44px] text-balance text-[#F40009] lg:text-[52px] lg:leading-[56px]">
            Ready to pick today’s lucky few?
          </h1>
          <p className="max-w-[340px] text-sm leading-[22px]">
            Sign in to run the daily draw, make the winners’ print files and download the sheet.
          </p>
        </div>
        <AdminLogin />
      </div>
    </main>
  );
}
