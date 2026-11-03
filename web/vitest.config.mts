import path from "node:path";

import { defineConfig, type Plugin } from "vitest/config";

/** Next turns `import x from "./a.png"` into { src, width, height }; tests need the same shape. */
const staticImages: Plugin = {
  name: "static-images",
  enforce: "pre",
  load(id) {
    if (!/\.(png|jpe?g|webp)$/.test(id)) return null;
    const name = path.basename(id);
    return `export default { src: "/_next/static/media/${name}", width: 400, height: 1000 };`;
  },
};

export default defineConfig({
  plugins: [staticImages],
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: {
    environment: "jsdom",
    // Screens run against the in-browser mock; the HTTP client has its own tests.
    env: { NEXT_PUBLIC_CAMPAIGN_API: "mock", NEXT_PUBLIC_GA_MEASUREMENT_ID: "G-TEST" },
    setupFiles: ["./test/setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules", ".next"],
  },
});
