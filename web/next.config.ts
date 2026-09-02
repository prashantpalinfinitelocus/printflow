import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // There are lockfiles higher up the tree; pin tracing to this app.
  outputFileTracingRoot: __dirname,
  // Bundles only the files the server actually needs, so the Docker runtime
  // stage can drop node_modules entirely.
  output: "standalone",
  // API_BASE_URL is deliberately NOT declared in `env`: that inlines the value
  // at build time, which would bake a localhost address into the image. It is
  // read at runtime in lib/session.ts, which is server-only.
};

export default config;
