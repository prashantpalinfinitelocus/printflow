import "server-only";

import { cookies } from "next/headers";

import type { User } from "./types";

export const TOKEN_COOKIE = "pf_token";
export const API_BASE = process.env.API_BASE_URL ?? "http://127.0.0.1:8000";

export async function getToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(TOKEN_COOKIE)?.value ?? null;
}

/** Server-side fetch against the FastAPI backend, authenticated from the cookie. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${API_BASE}${path}`, { ...init, headers, cache: "no-store" });
}

export async function apiJson<T>(path: string): Promise<T | null> {
  const res = await apiFetch(path);
  if (!res.ok) return null;
  return (await res.json()) as T;
}

/** The signed-in user, or null when the cookie is missing/expired. */
export async function getCurrentUser(): Promise<User | null> {
  const token = await getToken();
  if (!token) return null;
  return apiJson<User>("/auth/me");
}
