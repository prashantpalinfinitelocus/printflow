import { describe, expect, it } from "vitest";

import config from "./next.config";

describe("next.config", () => {
  it("serves the consumer campaign at the domain root, apart from the /offline-store app", async () => {
    const rules = await config.rewrites!();
    const all = Array.isArray(rules) ? rules : [...(rules.beforeFiles ?? []), ...(rules.afterFiles ?? []), ...(rules.fallback ?? [])];

    expect(all).toContainEqual({
      source: "/user-campaign/:path*",
      destination: "http://127.0.0.1:3000/offline-store/user-campaign/:path*",
      basePath: false,
    });
  });

  it("keeps the staff app under /offline-store", () => {
    expect(config.basePath).toBe("/offline-store");
  });
});
