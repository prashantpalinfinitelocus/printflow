import { describe, expect, it } from "vitest";

import config from "./next.config";

const SELF = "http://127.0.0.1:3000";

async function rewrites() {
  const rules = await config.rewrites!();
  return Array.isArray(rules) ? rules : [...(rules.beforeFiles ?? []), ...(rules.afterFiles ?? []), ...(rules.fallback ?? [])];
}

describe("next.config", () => {
  it("serves the consumer campaign at the domain root, apart from the /offline-store app", async () => {
    const all = await rewrites();

    expect(all).toContainEqual({
      source: "/user-campaign/:path*",
      destination: `${SELF}/offline-store/user-campaign/:path*`,
      basePath: false,
    });
  });

  it("shows the campaign landing at the bare domain", async () => {
    const all = await rewrites();

    expect(all).toContainEqual({
      source: "/",
      destination: `${SELF}/offline-store/user-campaign`,
      basePath: false,
    });
  });

  it("no longer sends the bare domain into the staff app", async () => {
    const redirects = await config.redirects!();

    expect(redirects.find((r) => r.source === "/")).toBeUndefined();
  });

  it("sends the old /user-campaign landing address to the bare domain, keeping the query", async () => {
    const redirects = await config.redirects!();

    expect(redirects).toContainEqual({ source: "/user-campaign", destination: "/", basePath: false, permanent: false });
  });

  it("does not touch anything under /offline-store", async () => {
    const all = await rewrites();
    const redirects = await config.redirects!();

    for (const rule of [...all, ...redirects]) {
      // Every rule is anchored to the root URLs the campaign owns, never to the staff app's paths.
      expect(rule.source.startsWith("/offline-store")).toBe(false);
      expect(["/", "/user-campaign", "/user-campaign/:path*"]).toContain(rule.source);
    }
  });

  it("keeps the staff app under /offline-store", () => {
    expect(config.basePath).toBe("/offline-store");
  });
});
