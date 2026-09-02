import { Suspense } from "react";

import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <section className="relative hidden overflow-hidden bg-brand-500 px-14 py-16 text-white lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.16]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(125deg, transparent 0 34px, #fff 34px 38px)",
          }}
        />
        <div className="relative">
          <div className="inline-flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-lg font-black text-brand-500">
              P
            </span>
            <span className="text-lg font-black tracking-tight">PrintFlow</span>
          </div>
        </div>

        <div className="relative max-w-md">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-white/70">
            Store print operations
          </p>
          <h1 className="mt-4 text-5xl leading-[1.02] font-black tracking-tight">
            Every order.
            <br />
            Every store.
            <br />
            <span className="text-cream">Print-ready.</span>
          </h1>
          <p className="mt-6 text-[15px] leading-relaxed text-white/85">
            Orders arrive by CSV, land in the right store&rsquo;s queue, and print as colour-separated
            TIFF straight from the design template — with a PDF proof for every job.
          </p>
        </div>

        <div className="relative flex gap-8 text-sm">
          {[
            ["300 dpi", "CMYK TIFF"],
            ["PDF", "proof per job"],
            ["Per store", "scoped queues"],
          ].map(([big, small]) => (
            <div key={big}>
              <p className="text-xl font-black">{big}</p>
              <p className="text-white/70">{small}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Form panel */}
      <section className="flex items-center justify-center px-6 py-14">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="inline-flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-500 text-lg font-black text-white">
                P
              </span>
              <span className="text-lg font-black tracking-tight">PrintFlow</span>
            </div>
          </div>

          <p className="eyebrow">Sign in</p>
          <h2 className="mt-2 text-3xl font-black tracking-tight">Welcome back</h2>
          <p className="mt-1.5 text-sm text-ink-400">
            Use the account your administrator issued you.
          </p>

          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        </div>
      </section>
    </main>
  );
}
