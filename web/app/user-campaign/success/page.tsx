import Image from "next/image";

import logo from "@/app/user-campaign/_assets/logo.png";
import successBg from "@/app/user-campaign/_assets/success-bg.jpg";
import webSuccessBg from "@/app/user-campaign/_assets/web-success-bg.jpg";
import { ImagePreload } from "@/components/campaign/ImagePreload";
import { TrackOnce } from "@/lib/campaign/analytics";
import { IMAGE_QUALITY } from "@/lib/campaign/imageQuality";

const BG_SIZES = "100vw";

/**
 * Thank-you — Figma 518:6536, and 518:6892 from 1024px up. Confirms the entry without implying a win
 * (PRD 10). The preview navigates here after the server accepts an entry; the
 * page itself is static and does not check that one was made.
 */
export default function SuccessPage() {
  return (
    <main className="relative min-h-dvh overflow-hidden bg-[#EDE7E2] text-center">
      <TrackOnce event="thank_you_viewed" />
      {/* Figma's 874px phone frame starts with a 99px mocked browser bar, so the photo starts that far above the screen. */}
      <div className="absolute inset-x-0 top-[-99px] bottom-0 lg:hidden" aria-hidden="true">
        <Image quality={IMAGE_QUALITY} src={successBg} alt="" fill placeholder="blur" sizes={BG_SIZES} className="object-cover" />
      </div>
      {/* Each size preloads only its own photo; the images stay lazy, so a hidden one is never fetched. */}
      <ImagePreload src={successBg} sizes={BG_SIZES} media="(max-width: 1023px)" />
      <ImagePreload src={webSuccessBg} sizes={BG_SIZES} media="(min-width: 1024px)" />
      {/* Web: the full-screen photo with the small logo top left. Figma also has the landing's large logo top right; it was left out on request. */}
      <div data-web-logos className="absolute inset-0 hidden lg:block" aria-hidden="true">
        <Image quality={IMAGE_QUALITY} src={webSuccessBg} alt="" fill placeholder="blur" sizes={BG_SIZES} className="object-cover" />
        <Image quality={IMAGE_QUALITY} src={logo} alt="" sizes="60px" className="absolute top-10 left-10 h-[27px] w-[60px] object-contain" />
      </div>
      {/*
        Figma: the 302px block's top is at 254px on the 775px screen, kept as an offset from centre.
        Web: a 612px block 353px down the 900px screen, without the logo above it.
      */}
      <div className="absolute top-[calc(50%-133.5px)] left-1/2 flex w-[302px] -translate-x-1/2 flex-col items-center gap-4 lg:top-[39.23%] lg:w-[612px]">
        <Image quality={IMAGE_QUALITY} src={logo} alt="Diet Coke" sizes="72px" className="h-8 w-[72px] object-contain lg:hidden" />
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
