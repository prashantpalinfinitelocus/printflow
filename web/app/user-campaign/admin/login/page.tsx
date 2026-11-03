import type { Metadata } from "next";
import Image from "next/image";

import landingCan from "@/app/user-campaign/_assets/landing-can.png";
import logo from "@/app/user-campaign/_assets/logo.png";
import mobileBg from "@/app/user-campaign/_assets/mobile-bg.jpg";
import webBg from "@/app/user-campaign/_assets/web-landing-bg.jpg";
import { IMAGE_QUALITY } from "@/lib/campaign/imageQuality";

import { AdminLogin } from "./AdminLogin";

export const metadata: Metadata = { title: "Campaign admin sign in", robots: { index: false, follow: false } };

/**
 * The campaign admin's sign-in. Figma has no design for it, so it borrows the landing's photo and
 * tilted can, floating on the left from 1024px and above the form on phones tall enough for both,
 * with its shadow following it. The headline and form share one left edge, directly on the photo.
 */
export default function AdminLoginPage() {
  return (
    <main className="relative flex min-h-dvh w-full flex-col items-center justify-center overflow-hidden bg-[#ECEDEF] px-5 py-12 text-[#494949] lg:p-0">
      <div data-backdrop className="absolute inset-0" aria-hidden="true">
        <div className="absolute inset-x-0 top-[-99px] bottom-0 lg:hidden">
          <Image quality={IMAGE_QUALITY} src={mobileBg} alt="" fill placeholder="blur" sizes="100vw" className="object-cover" />
        </div>
        <div className="absolute inset-0 hidden lg:block">
          <Image quality={IMAGE_QUALITY} src={webBg} alt="" fill placeholder="blur" sizes="100vw" className="object-cover" />
        </div>
      </div>

      {/* Placed as on the landing on web. The shadow's size and place are shares of this box, so it scales with the can. */}
      <div
        data-can-slot
        aria-hidden="true"
        className="relative mb-10 hidden aspect-[170/423] h-[150px] shrink-0 [@media(min-height:770px)]:block lg:absolute lg:top-[48.78%] lg:left-[34.83%] lg:mb-0 lg:block lg:h-[72.35dvh] lg:-translate-x-1/2 lg:-translate-y-1/2"
      >
        <div data-float-x className="animate-float-x absolute inset-0">
          <div className="animate-can-drop absolute inset-0">
            <div data-can className="animate-float-can absolute inset-0 rotate-[17.91deg]">
              <Image quality={IMAGE_QUALITY} src={landingCan} alt="" fill priority placeholder="blur" sizes="(min-width: 1024px) 30vh, 80px" className="object-contain" />
            </div>
          </div>
          <div className="animate-fade-in absolute top-[107.3%] left-[-25.3%] h-[2.6%] w-[98.2%]">
            <div data-shadow className="animate-float-shadow h-full w-full rounded-[50%] bg-black/14 blur-[4px]" />
          </div>
        </div>
      </div>

      <Image
        quality={IMAGE_QUALITY}
        src={logo}
        alt="Diet Coke"
        priority
        sizes="60px"
        className="absolute top-4 right-4 h-[27px] w-[60px] object-contain lg:top-10 lg:right-auto lg:left-10"
      />

      <div
        data-panel
        className="relative w-full max-w-[362px] lg:absolute lg:top-1/2 lg:left-[59.03%] lg:w-[400px] lg:max-w-[min(400px,calc(100vw-59.03%-40px))] lg:-translate-y-1/2"
      >
        <div
          data-content
          className="animate-rise-in flex flex-col gap-6 lg:gap-8"
        >
          <div className="flex flex-col gap-3">
            <h1 className="font-[family-name:var(--dc-serif)] text-[36px] leading-[44px] text-balance text-[#F40009] lg:text-[48px] lg:leading-14">
              Ready to pick today’s lucky few?
            </h1>
            <p className="text-sm leading-[22px] text-pretty lg:text-base lg:leading-6">
              Sign in to run the daily draw, make the winners’ print files and download the sheet.
            </p>
          </div>
          <AdminLogin />
        </div>
      </div>
    </main>
  );
}
