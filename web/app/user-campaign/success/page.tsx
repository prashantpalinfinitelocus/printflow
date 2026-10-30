import Image from "next/image";

import logo from "@/app/user-campaign/_assets/logo.png";
import successBg from "@/app/user-campaign/_assets/success-bg.png";

/**
 * Thank-you — Figma 243:1094. Confirms the entry without implying a win
 * (PRD 10). The preview navigates here after the server accepts an entry; the
 * page itself is static and does not check that one was made.
 */
export default function SuccessPage() {
  return (
    <main className="relative min-h-dvh overflow-hidden text-center">
      {/* The design crops the photo tighter than the screen: 458px wide, top 99px under the browser bar. */}
      <div className="absolute inset-x-[-7%] top-[-12.8%] bottom-0" aria-hidden="true">
        <Image src={successBg} alt="" fill priority sizes="(max-width: 480px) 115vw, 552px" className="object-cover" />
      </div>
      {/* Figma: the 302px block's top is at 254px on the 775px screen, kept as an offset from centre. */}
      <div className="absolute top-[calc(50%-133.5px)] left-1/2 flex w-[302px] -translate-x-1/2 flex-col items-center gap-4">
        <Image src={logo} alt="Diet Coke" sizes="72px" className="h-8 w-[72px] object-contain" />
        <div className="flex flex-col gap-2">
          <h1 className="flex flex-col">
            <span className="text-2xl leading-[27px] font-bold">You ate! </span>
            <span className="font-[family-name:var(--dc-serif)] text-[38px] leading-[43px] text-[#F40009]">
              Your <em>entry</em> is in..
            </span>
          </h1>
          <p className="mx-auto w-[280px] text-sm leading-[21px]">
            Fingers crossed! If you’re selected, we’ll hit your inbox.
          </p>
        </div>
      </div>
    </main>
  );
}
