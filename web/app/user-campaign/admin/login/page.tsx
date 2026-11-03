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
 * The campaign admin's sign-in, dressed like the web landing (Figma 518:7085): its photo over the
 * whole page, the can dropping into its tilt and then drifting slowly on the left from 1024px, the
 * logo in the corner, and a serif headline with the form where the landing has its copy. Figma has
 * no design for this page. Phones get the photo, the logo and the form.
 */
export default function AdminLoginPage() {
  return (
    <main className="relative flex min-h-dvh w-full flex-col items-center justify-center overflow-hidden bg-[#ECEDEF] px-6 pt-16 pb-12 text-[#494949] lg:p-0">
      <div data-backdrop className="absolute inset-0" aria-hidden="true">
        <div className="absolute inset-x-0 top-[-99px] bottom-0 lg:hidden">
          <Image quality={IMAGE_QUALITY} src={mobileBg} alt="" fill placeholder="blur" sizes="100vw" className="object-cover" />
        </div>
        <div className="absolute inset-0 hidden lg:block">
          <Image quality={IMAGE_QUALITY} src={webBg} alt="" fill placeholder="blur" sizes="100vw" className="object-cover" />
        </div>
        {/* Placed as on the landing; the inner box takes the tilt and the drift, which animate its rotate and translate. */}
        <div
          data-can-slot
          className="absolute top-[48.78%] left-[34.83%] hidden aspect-[170/423] h-[72.35dvh] -translate-x-1/2 -translate-y-1/2 lg:block"
        >
          <div data-can className="animate-can-float absolute inset-0 rotate-[17.91deg] motion-reduce:animate-none">
            <Image quality={IMAGE_QUALITY} src={landingCan} alt="" fill priority placeholder="blur" sizes="30vh" className="object-contain" />
          </div>
        </div>
        <div className="absolute top-[90.22%] left-[30.08%] hidden h-[17px] w-[257px] -translate-x-1/2 rounded-[50%] bg-black/14 blur-[4px] lg:block" />
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
        className="relative flex w-full max-w-[354px] flex-col gap-8 lg:absolute lg:top-1/2 lg:left-[59.03%] lg:w-[401px] lg:max-w-[min(401px,calc(100vw-59.03%-40px))] lg:-translate-y-1/2"
      >
        <div className="flex flex-col gap-2 text-center lg:gap-4">
          <h1 className="font-[family-name:var(--dc-serif)] text-[32px] leading-10 text-balance text-[#F40009] lg:text-[40px] lg:leading-12">
            Ready to pick today’s lucky few?
          </h1>
          <p className="mx-auto max-w-[316px] text-sm leading-[21px] text-balance">
            Sign in to run the daily draw, make the winners’ print files and download the sheet.
          </p>
        </div>
        <AdminLogin />
      </div>
    </main>
  );
}
