import type { NextConfig } from "next";

import { BASE_PATH } from "./lib/basePath";

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
  },
  // Every page lives under /offline/store (see lib/basePath.ts).
  basePath: BASE_PATH,
  // The bare domain sends every visitor, signed in or not, into the app.
  // basePath: false matches "/" itself rather than "/offline/store/".
  async redirects() {
    return [{ source: "/", destination: BASE_PATH, basePath: false, permanent: false }];
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
