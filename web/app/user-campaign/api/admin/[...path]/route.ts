import { NextResponse, type NextRequest } from "next/server";

import { ADMIN_API, LOGIN_PATH } from "@/lib/campaign/admin";

/**
 * Passthrough from the campaign admin pages to the API's /campaign-admin routes, at
 * /user-campaign/api/admin with the rest of the campaign.
 *
 * The campaign is its own system: this has nothing to do with PrintFlow's /api/proxy or its
 * login. The campaign admin's token lives in its own httpOnly cookie, set here when
 * auth/login succeeds, so page scripts never hold it.
 */

const SESSION_COOKIE = "dc_admin";
/** Only this route needs the cookie, so no other path on the domain receives it. */
const COOKIE_PATH = ADMIN_API;

/** A segment that could climb out of /campaign-admin once the URL is normalised, however it is encoded. */
function unsafeSegment(segment: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return true;
  }
  return decoded === "" || decoded === "." || decoded === ".." || /[\\/]/.test(decoded);
}

/** The API, read straight from the environment rather than through PrintFlow's session module. */
const apiBase = () => process.env.API_BASE_URL ?? "http://127.0.0.1:8000";

const HOP_BY_HOP = new Set(["connection", "content-encoding", "content-length", "keep-alive", "transfer-encoding"]);

async function forward(request: NextRequest, path: string[]) {
  if (path.some(unsafeSegment)) return NextResponse.json({ detail: "Not found" }, { status: 404 });
  const route = path.join("/");
  const token = request.cookies.get(SESSION_COOKIE)?.value;

  // A TIFF link from the sheet, opened in a browser while signed out: show the login, not a JSON error.
  const browserOpening = request.method === "GET" && Boolean(request.headers.get("accept")?.includes("text/html"));
  const toLogin = () => new NextResponse(null, { status: 307, headers: { Location: LOGIN_PATH } });
  if (!token && browserOpening) return toLogin();

  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const body = request.method === "GET" ? undefined : await request.arrayBuffer();

  let upstream: Response;
  try {
    upstream = await fetch(`${apiBase()}/campaign-admin/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`, {
      method: request.method,
      headers,
      body: body && body.byteLength > 0 ? body : undefined,
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ detail: "Cannot reach the campaign API. Please try again." }, { status: 503 });
  }

  // Reached through the /user-campaign rewrite, so the scheme the browser used is in the forwarded header.
  const https = request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto")?.split(",")[0] === "https";
  const cookie = { httpOnly: true, sameSite: "lax" as const, secure: https, path: COOKIE_PATH };

  if (route === "auth/login") {
    const data = await upstream.json().catch(() => null);
    if (!upstream.ok) return NextResponse.json({ detail: data?.detail ?? "Sign-in failed" }, { status: upstream.status });
    const response = NextResponse.json({ admin: data.admin });
    response.cookies.set({ name: SESSION_COOKIE, value: data.token, maxAge: data.expires_in, ...cookie });
    return response;
  }

  if (route === "auth/logout") {
    // Signed out here whatever the API said; an already-revoked token is no reason to keep the cookie.
    const response = new NextResponse(null, { status: 204 });
    response.cookies.set({ name: SESSION_COOKIE, value: "", maxAge: 0, ...cookie });
    return response;
  }

  // The same for a session that has since expired or been signed out.
  if (upstream.status === 401 && browserOpening) return toLogin();

  const outHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) outHeaders.set(key, value);
  });
  return new NextResponse(upstream.status === 204 ? null : upstream.body, { status: upstream.status, headers: outHeaders });
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  return forward(request, (await ctx.params).path);
}
export async function POST(request: NextRequest, ctx: Ctx) {
  return forward(request, (await ctx.params).path);
}
export async function PATCH(request: NextRequest, ctx: Ctx) {
  return forward(request, (await ctx.params).path);
}
export async function DELETE(request: NextRequest, ctx: Ctx) {
  return forward(request, (await ctx.params).path);
}
