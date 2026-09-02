import { NextResponse } from "next/server";

import { API_BASE, getToken } from "@/lib/session";

/**
 * Single authenticated passthrough to the FastAPI backend.
 *
 * The browser never holds the JWT — it calls `/api/proxy/<path>` and this route
 * attaches the bearer token from the httpOnly cookie. Binary responses (TIFF,
 * PDF, PNG previews) are streamed back untouched with their disposition intact.
 */

const HOP_BY_HOP = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "transfer-encoding",
]);

async function forward(request: Request, path: string[]) {
  const token = await getToken();
  if (!token) {
    return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  }

  const incoming = new URL(request.url);
  const target = `${API_BASE}/${path.map(encodeURIComponent).join("/")}${incoming.search}`;

  const headers = new Headers();
  headers.set("Authorization", `Bearer ${token}`);
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const accept = request.headers.get("accept");
  if (accept) headers.set("accept", accept);

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const body = hasBody ? await request.arrayBuffer() : undefined;

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
      { detail: "Cannot reach the PrintFlow API. Is the backend running?" },
      { status: 503 },
    );
  }

  const outHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) outHeaders.set(key, value);
  });

  if (upstream.status === 204) {
    return new NextResponse(null, { status: 204, headers: outHeaders });
  }

  return new NextResponse(upstream.body, { status: upstream.status, headers: outHeaders });
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, ctx: Ctx) {
  return forward(request, (await ctx.params).path);
}
export async function POST(request: Request, ctx: Ctx) {
  return forward(request, (await ctx.params).path);
}
export async function PATCH(request: Request, ctx: Ctx) {
  return forward(request, (await ctx.params).path);
}
export async function PUT(request: Request, ctx: Ctx) {
  return forward(request, (await ctx.params).path);
}
export async function DELETE(request: Request, ctx: Ctx) {
  return forward(request, (await ctx.params).path);
}
