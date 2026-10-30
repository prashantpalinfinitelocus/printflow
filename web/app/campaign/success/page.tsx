import Image from "next/image";

import logo from "@/app/campaign/_assets/logo.png";
import successBg from "@/app/campaign/_assets/success-bg.png";

/**
 * Thank-you — Figma 243:1094. Confirms the entry without implying a win
 * (PRD 10). Reached only after the server accepted the entry.
 */
export default function SuccessPage() {
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-[50px] text-center">
      {/* The design crops the photo tighter than the screen: 458px wide, top 99px under the browser bar. */}
      <div className="absolute inset-x-[-7%] top-[-12.8%] bottom-0" aria-hidden="true">
        <Image src={successBg} alt="" fill priority sizes="(max-width: 430px) 115vw, 495px" className="object-cover" />
      </div>
      <div className="relative flex flex-col items-center gap-4">
        <Image src={logo} alt="Diet Coke" sizes="72px" className="h-8 w-[72px] object-contain" />
        <div className="flex flex-col gap-2">
          <h1 className="flex flex-col">
            <span className="text-2xl leading-[1.14] font-bold">You ate! </span>
            <span className="font-[family-name:var(--dc-serif)] text-[38px] leading-[1.14] text-[#F40009]">
              Your <em>entry</em> is in..
            </span>
          </h1>
          <p className="mx-auto max-w-[262px] text-sm leading-[1.5]">
            Fingers crossed! If you’re selected, we’ll hit your inbox.
          </p>
        </div>
      </div>
    </main>
  );
}
