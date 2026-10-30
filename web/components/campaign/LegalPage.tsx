import Image from "next/image";
import Link from "next/link";

import logo from "@/app/campaign/_assets/logo.png";

/**
 * Shared layout for the Terms & Conditions and Privacy Policy pages.
 * `html` is our own static copy (see the pages' content.ts), never user input.
 */
export function LegalPage({ title, html }: { title: string; html: string }) {
  return (
    <main className="flex min-h-dvh flex-col gap-6 px-6 pt-4 pb-10 text-[#494949]">
      <header className="flex items-center justify-between">
        <Link href="/campaign" className="text-sm font-semibold text-black">
          ← Back
        </Link>
        <Image src={logo} alt="Diet Coke" sizes="90px" className="h-10 w-[90px] object-contain" />
      </header>
      <h1 className="font-[family-name:var(--dc-serif)] text-[32px] leading-10 text-[#F40009]">{title}</h1>
      <div
        className="space-y-4 text-sm leading-[1.5] break-words [&_a]:text-[#1985d3] [&_a]:underline [&_h2]:font-bold [&_h2]:text-black [&_li]:mt-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:text-black [&_ul]:list-disc [&_ul]:pl-5"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </main>
  );
}
