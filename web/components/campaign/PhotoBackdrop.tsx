import Image from "next/image";

import logo from "@/app/user-campaign/_assets/logo.png";
import mobileBg from "@/app/user-campaign/_assets/mobile-bg.jpg";
import webPanelBg from "@/app/user-campaign/_assets/web-panel-bg.jpg";
import { ImagePreload } from "@/components/campaign/ImagePreload";
import { IMAGE_QUALITY } from "@/lib/campaign/imageQuality";

/** The page behind the create and preview screens: the photo on phones, white with a photo panel on web. */
export const PHOTO_PAGE = "relative h-dvh overflow-hidden bg-[#D7D8D8] lg:bg-white";

/** The photo behind the create and preview screens; each size preloads only its own, with a blurred stand-in until it arrives. */
export function PhotoBackdrop() {
  return (
    <>
      <ImagePreload src={mobileBg} sizes="100vw" media="(max-width: 1023px)" />
      <ImagePreload src={webPanelBg} sizes="54vw" media="(min-width: 1024px)" />
      {/* Figma's 874px phone frame starts with a 99px mocked browser bar, so the photo starts that far above the screen. */}
      <div className="absolute inset-x-0 top-[-99px] bottom-0 lg:hidden" aria-hidden="true">
        <Image quality={IMAGE_QUALITY} src={mobileBg} alt="" fill placeholder="blur" sizes="100vw" className="object-cover" />
      </div>
      {/* Web: the 768px photo panel behind the can, with the small logo. */}
      <div data-web-panel className="absolute inset-y-0 left-0 hidden w-[53.33%] lg:block" aria-hidden="true">
        <Image quality={IMAGE_QUALITY} src={webPanelBg} alt="" fill placeholder="blur" sizes="54vw" className="object-cover" />
        <Image quality={IMAGE_QUALITY} src={logo} alt="" sizes="60px" className="absolute top-10 left-10 h-[27px] w-[60px] object-contain" />
      </div>
    </>
  );
}
