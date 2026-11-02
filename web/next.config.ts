import type { NextConfig } from "next";

import { BASE_PATH } from "./lib/basePath";

/** This server, as seen from inside the container (the image listens on 3000). */
const SELF_ORIGIN = `http://127.0.0.1:${process.env.PORT ?? 3000}`;

const config: NextConfig = {
  reactStrictMode: true,
  // There are lockfiles higher up the tree; pin tracing to this app.
  outputFileTracingRoot: __dirname,
  // Bundles only the files the server actually needs, so the Docker runtime
  // stage can drop node_modules entirely.
  output: "standalone",
  experimental: {
    // Middleware runs on every request, including /api/proxy uploads, and by
    // default hands only the first 10MB of a body on to the route. A 20MB PSD
    // reached the API cut off mid-file and failed with "file: Field required".
    middlewareClientMaxBodySize: "100mb",
    // The /user-campaign rewrite below is a proxy, which gives up after 30 seconds by default.
    // The campaign admin renders a print-resolution TIFF inside one request, so allow longer.
    proxyTimeout: 120_000,
  },
  // Every page lives under /offline-store (see lib/basePath.ts).
  basePath: BASE_PATH,
  // The consumer campaign owns the bare domain: "/" shows its landing, and the old
  // /user-campaign landing address sends visitors there (the query, such as ?login=1, is kept).
  // basePath: false matches the root URLs themselves rather than paths under /offline-store.
  // Staff reach their app at /offline-store, which none of these rules touch.
  async redirects() {
    return [{ source: "/user-campaign", destination: "/", basePath: false, permanent: false }];
  },
  // The campaign is served from the domain root, separate from the /offline-store staff app.
  // Next serves every route under the basePath and refuses an internal rewrite out of it, so the
  // root URLs are proxied to this same server's /offline-store URLs. The journey then navigates
  // with full page loads (lib/campaign/nav.ts) so the address bar never drifts into /offline-store.
  // Static files load from /offline-store/_next, which the load balancer already sends to this
  // service; /, /user-campaign and /user-campaign/* need the same route (docs/CAMPAIGN_CONFIG.md).
  async rewrites() {
    return [
      { source: "/", destination: `${SELF_ORIGIN}${BASE_PATH}/user-campaign`, basePath: false },
      {
        source: "/user-campaign/:path*",
        destination: `${SELF_ORIGIN}${BASE_PATH}/user-campaign/:path*`,
        basePath: false,
      },
    ];
  },
  // Baseline browser protections on every response, including the proxied
  // TIFF/PDF/PNG downloads: no content-type sniffing, no framing, and no
  // full-URL referrer leaks.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
  // API_BASE_URL is deliberately NOT declared in `env`: that inlines the value
  // at build time, which would bake a localhost address into the image. It is
  // read at runtime in lib/session.ts, which is server-only.
};

export default config;
