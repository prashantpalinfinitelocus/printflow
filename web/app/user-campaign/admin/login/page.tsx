import type { Metadata } from "next";
import Image from "next/image";

import logo from "@/app/user-campaign/_assets/logo.png";
import { IMAGE_QUALITY } from "@/lib/campaign/imageQuality";

import { AdminLogin } from "./AdminLogin";

export const metadata: Metadata = { title: "Campaign admin sign in", robots: { index: false, follow: false } };

export default function AdminLoginPage() {
  return (
    <main className="flex min-h-dvh w-full items-center justify-center bg-white px-6 py-12 text-[#494949]">
      <div className="flex w-full max-w-[380px] flex-col items-center gap-8">
        <Image quality={IMAGE_QUALITY} src={logo} alt="Diet Coke" priority sizes="112px" className="h-[49.8px] w-28 object-contain" />
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="text-[10px] leading-3 font-semibold tracking-[1.6px] text-[#F40009] uppercase">Diet Coke · Campaign admin</p>
          <h1 className="font-[family-name:var(--dc-serif)] text-[32px] leading-10 text-[#F40009]">Sign in</h1>
        </div>
        <AdminLogin />
      </div>
    </main>
  );
}
