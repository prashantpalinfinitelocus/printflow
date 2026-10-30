import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { BASE_PATH } from "./lib/basePath";
import { middleware } from "./middleware";

const request = (path: string, cookie?: string) =>
  new NextRequest(`http://localhost${BASE_PATH}${path}`, {
    headers: cookie ? { cookie } : {},
    nextConfig: { basePath: BASE_PATH },
  });

const redirectedTo = (res: Response) => res.headers.get("location");

describe("middleware", () => {
  it.each(["/user-campaign", "/user-campaign/create", "/user-campaign/preview", "/user-campaign/success"])(
    "lets a consumer without a staff cookie reach %s",
    (path) => {
      expect(redirectedTo(middleware(request(path)))).toBeNull();
    },
  );

  it.each(["/api/campaign/otp/send", "/api/campaign/window"])(
    "lets the campaign proxy %s through without a staff cookie",
    (path) => {
      expect(redirectedTo(middleware(request(path)))).toBeNull();
    },
  );

  it("still sends a staff page without a cookie to the PrintFlow login", () => {
    expect(redirectedTo(middleware(request("/queue")))).toBe(`http://localhost${BASE_PATH}/login?next=%2Fqueue`);
  });

  it("does not treat a look-alike path as the campaign", () => {
    expect(redirectedTo(middleware(request("/user-campaigns-admin")))).toContain("/login");
  });
});
