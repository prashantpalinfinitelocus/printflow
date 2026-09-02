"use client";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function proxyUrl(path: string): string {
  return `/api/proxy${path.startsWith("/") ? path : `/${path}`}`;
}

async function toError(res: Response): Promise<ApiError> {
  let detail = `Request failed (${res.status})`;
  try {
    const data = await res.json();
    if (typeof data?.detail === "string") {
      detail = data.detail;
    } else if (Array.isArray(data?.detail)) {
      // FastAPI validation errors: surface the first field message.
      const first = data.detail[0];
      detail = first?.msg ? `${first.loc?.slice(1).join(".") ?? "field"}: ${first.msg}` : detail;
    }
  } catch {
    /* non-JSON error body — keep the generic message */
  }
  return new ApiError(detail, res.status);
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(proxyUrl(path), { ...init, cache: "no-store" });
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const get = <T,>(path: string) => api<T>(path);

export const post = <T,>(path: string, body?: unknown) =>
  api<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

export const patch = <T,>(path: string, body: unknown) =>
  api<T>(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export const del = (path: string) => api<void>(path, { method: "DELETE" });

export async function upload<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(proxyUrl(path), { method: "POST", body: form, cache: "no-store" });
  if (!res.ok) throw await toError(res);
  return (await res.json()) as T;
}

/** Artifact URLs are served through the same authenticated proxy. */
export const artifactUrl = (orderId: number, kind: "tiff" | "pdf" | "preview", jobId?: number) =>
  proxyUrl(`/orders/${orderId}/artifact/${kind}${jobId ? `?job_id=${jobId}` : ""}`);
