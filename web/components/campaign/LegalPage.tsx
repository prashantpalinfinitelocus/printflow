import Image from "next/image";

import logo from "@/app/user-campaign/_assets/logo.png";
import { IMAGE_QUALITY } from "@/lib/campaign/imageQuality";

/**
 * Shared layout for the Terms & Conditions and Privacy Policy pages. Figma has no design for
 * them, so they borrow the campaign's pieces: the sticky header carries Back and the logo
 * where the other screens put it, the eyebrow and red serif title open the page, and the
 * copy runs the full width from the left.
 * `html` is our own static copy (see the pages' content.ts), never user input.
 */
export function LegalPage({ title, html }: { title: string; html: string }) {
  return (
    <div className="flex min-h-dvh w-full flex-col bg-white text-[#494949]">
      <header className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm">
        <div className="flex h-[72px] w-full items-center justify-between px-6 lg:h-[130px] lg:px-10">
          <a
            href="/user-campaign"
            className="flex items-center gap-1.5 text-sm leading-4 font-semibold text-black lg:text-base"
          >
            <span aria-hidden="true">←</span>
            Back
          </a>
          <Image quality={IMAGE_QUALITY} src={logo} alt="Diet Coke" sizes="112px" className="h-10 w-[90px] object-contain lg:h-[49.8px] lg:w-28" />
        </div>
      </header>

      <main className="flex-1 px-6 pt-4 pb-12 lg:px-10 lg:pt-6 lg:pb-20">
        <article className="flex w-full flex-col gap-8 lg:gap-10">
          <div className="flex flex-col gap-3 lg:gap-4">
            <p className="text-[10px] leading-3 font-semibold tracking-[1.6px] text-[#F40009] uppercase lg:text-xs lg:leading-4">
              Diet Coke &nbsp;·&nbsp; Custom Edition
            </p>
            <h1 className="font-[family-name:var(--dc-serif)] text-[32px] leading-10 text-[#F40009] lg:text-[56px] lg:leading-[60px]">
              {title}
            </h1>
          </div>
          <div
            className={[
              "flex flex-col gap-4 text-sm leading-[22px] break-words lg:text-base lg:leading-[26px]",
              "[&_a]:font-semibold [&_a]:text-[#F40009] [&_a]:underline [&_a]:underline-offset-2",
              "[&_h2]:mt-2 [&_h2]:font-[family-name:var(--dc-headline)] [&_h2]:text-base [&_h2]:leading-6 [&_h2]:font-bold [&_h2]:text-black lg:[&_h2]:text-xl lg:[&_h2]:leading-7",
              "[&_strong]:text-black [&_li]:mt-3 [&_li]:pl-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5",
              "[&_li::marker]:font-semibold [&_li::marker]:text-black [&_[id]]:scroll-mt-24 lg:[&_[id]]:scroll-mt-36",
            ].join(" ")}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </article>
      </main>
    </div>
  );
}
