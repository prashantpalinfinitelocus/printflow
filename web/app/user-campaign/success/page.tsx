import Image from "next/image";

import logo from "@/app/user-campaign/_assets/logo.png";
import successBg from "@/app/user-campaign/_assets/success-bg.png";
import webSuccessBg from "@/app/user-campaign/_assets/web-success-bg.jpg";
import { ImagePreload } from "@/components/campaign/ImagePreload";

const BG_SIZES = "(max-width: 480px) 115vw, 552px";

/**
 * Thank-you — Figma 243:1094, and 356:1102 from 1024px up. Confirms the entry without implying a win
 * (PRD 10). The preview navigates here after the server accepts an entry; the
 * page itself is static and does not check that one was made.
 */
export default function SuccessPage() {
  return (
    <main className="relative min-h-dvh overflow-hidden text-center">
      {/* The design crops the photo tighter than the screen: 458px wide, top 99px under the browser bar. */}
      <div className="absolute inset-x-[-7%] top-[-12.8%] bottom-0 lg:hidden" aria-hidden="true">
        <Image src={successBg} alt="" fill sizes={BG_SIZES} className="object-cover" />
      </div>
      {/*
        Web: the photo is 1672 × 941 from 116px left and 20px above the 1440 × 900 screen. Figma
        shows two logos, a small one top left and the landing's large one top right over the glass.
      */}
      {/* Each size preloads only its own photo; the images stay lazy, so a hidden one is never fetched. */}
      <ImagePreload src={successBg} sizes={BG_SIZES} media="(max-width: 1023px)" />
      <ImagePreload src={webSuccessBg} sizes="116vw" media="(min-width: 1024px)" />
      <div data-web-logos className="absolute inset-0 hidden lg:block" aria-hidden="true">
        <div className="absolute top-[-2.22%] left-[-8.06%] h-[104.56%] w-[116.11%]">
          <Image src={webSuccessBg} alt="" fill sizes="116vw" className="object-cover" />
        </div>
        <Image src={logo} alt="" sizes="60px" className="absolute top-10 left-10 h-[27px] w-[60px] object-contain" />
        <Image src={logo} alt="" sizes="112px" className="absolute top-10 right-10 h-[49.8px] w-28 object-contain" />
      </div>
      {/*
        Figma: the 302px block's top is at 254px on the 775px screen, kept as an offset from centre.
        Web: a 612px block 353px down the 900px screen, without the logo above it.
      */}
      <div className="absolute top-[calc(50%-133.5px)] left-1/2 flex w-[302px] -translate-x-1/2 flex-col items-center gap-4 lg:top-[39.23%] lg:w-[612px]">
        <Image src={logo} alt="Diet Coke" sizes="72px" className="h-8 w-[72px] object-contain lg:hidden" />
        <div className="flex flex-col gap-2 lg:gap-[13.6px]">
          <h1 className="flex flex-col">
            <span className="text-2xl leading-[27px] font-bold lg:text-[32px] lg:leading-[36.48px]">You ate!</span>
            <span className="font-[family-name:var(--dc-serif)] text-[38px] leading-[43px] text-[#F40009] lg:text-[64px] lg:leading-[72.96px]">
              Your <em>entry</em> is in..
            </span>
          </h1>
          <p className="mx-auto w-[280px] text-sm leading-[21px] lg:w-auto lg:text-[27.19px] lg:leading-[35.69px]">
            Fingers crossed! If you’re selected, we’ll hit your inbox.
          </p>
        </div>
      </div>
    </main>
  );
}
