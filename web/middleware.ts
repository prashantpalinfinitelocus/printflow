import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const TOKEN_COOKIE = "pf_token";
const PUBLIC_PATHS = ["/login", "/api/auth/login"];

/** A same-app URL: nextUrl keeps the basePath that new URL(path, request.url) would drop. */
function appUrl(request: NextRequest, pathname: string) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  return url;
}

export function middleware(request: NextRequest) {
  // pathname is relative to the basePath, e.g. "/login", not "/offline/store/login".
  const { pathname } = request.nextUrl;
  const hasToken = Boolean(request.cookies.get(TOKEN_COOKIE)?.value);

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    if (hasToken && pathname === "/login") {
      return NextResponse.redirect(appUrl(request, "/"));
    }
    return NextResponse.next();
  }

  if (!hasToken) {
    const url = appUrl(request, "/login");
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
