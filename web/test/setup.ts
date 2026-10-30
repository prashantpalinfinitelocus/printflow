import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, vi } from "vitest";

import { router, searchParams } from "./navigation";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  router.push.mockReset();
  router.replace.mockReset();
  searchParams.value = new URLSearchParams();
});

/* next/navigation needs the App Router runtime; tests assert on these spies instead. */
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => searchParams.value,
}));

/* next/image needs Next's image config; a plain <img> is enough for behaviour tests. */
vi.mock("next/image", () => ({
  default: ({ src, alt, fill: _fill, priority: _priority, sizes: _sizes, ...rest }: Record<string, unknown>) =>
    createElement("img", { src: (src as { src?: string })?.src ?? src, alt, ...rest }),
}));

/* next/font is compiled by Next's SWC plugin and cannot run under Vitest. */
vi.mock("@/lib/campaign/fonts", () => {
  const font = (name: string) => ({ variable: `font-${name}`, className: name, style: { fontFamily: name } });
  return { sans: font("sans"), serif: font("serif"), canFont: font("can") };
});
