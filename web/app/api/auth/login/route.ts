import { NextResponse } from "next/server";

import { API_BASE, TOKEN_COOKIE } from "@/lib/session";

/**
 * Exchanges credentials for a JWT and parks it in an httpOnly cookie, so the
 * token is never readable by page scripts.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body?.email || !body?.password) {
    return NextResponse.json({ detail: "Email and password are required" }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: body.email, password: body.password }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { detail: "Cannot reach the PrintFlow API. Is the backend running?" },
      { status: 503 },
    );
  }

  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    const detail = typeof data?.detail === "string" ? data.detail : "Login failed";
    return NextResponse.json({ detail }, { status: upstream.status });
  }

  const response = NextResponse.json({ user: data.user });
  response.cookies.set({
    name: TOKEN_COOKIE,
    value: data.access_token,
    httpOnly: true,
    sameSite: "lax",
    // NODE_ENV is "production" in every Docker build regardless of whether
    // the request actually arrived over TLS — keying off it here means the
    // Secure flag gets set even for plain-HTTP deployments, and browsers
    // silently drop Secure cookies on non-HTTPS origins. Key off the actual
    // request scheme instead.
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    maxAge: data.expires_in,
  });
  return response;
}
