import { NextResponse, type NextRequest } from "next/server";

import { API_BASE } from "@/lib/session";

/**
 * Passthrough from the consumer campaign pages to the API's /campaign routes.
 *
 * Separate from /api/proxy, which only serves signed-in staff. The participant
 * token lives in its own httpOnly cookie, set here when /otp/verify succeeds,
 * so page scripts never hold it — the same pattern as the staff login.
 */

const SESSION_COOKIE = "dc_token";

async function forward(request: NextRequest, path: string[]) {
  const target = `${API_BASE}/campaign/${path.map(encodeURIComponent).join("/")}`;
  const headers = new Headers();
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  const body = request.method === "GET" ? undefined : await request.arrayBuffer();

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: body && body.byteLength > 0 ? body : undefined,
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { detail: { code: "UNAVAILABLE", message: "We can’t reach the campaign right now. Please try again." } },
      { status: 503 },
    );
  }

  const data = await upstream.json().catch(() => null);
  if (path.join("/") !== "otp/verify" || !upstream.ok) {
    return NextResponse.json(data, { status: upstream.status });
  }

  const { token: issued, expires_in, ...session } = data;
  const response = NextResponse.json(session);
  response.cookies.set({
    name: SESSION_COOKIE,
    value: issued,
    httpOnly: true,
    sameSite: "lax",
    // Key off the request scheme, not NODE_ENV — see app/api/auth/login/route.ts.
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    maxAge: expires_in,
  });
  return response;
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  return forward(request, (await ctx.params).path);
}
export async function POST(request: NextRequest, ctx: Ctx) {
  return forward(request, (await ctx.params).path);
}
