import { vi } from "vitest";

/** The router every component gets from the mocked next/navigation (see setup.ts). */
export const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() };
