import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  external: ["react"],
  // Toast/SlideOver/etc. use hooks; tsup bundles everything into one file so
  // a per-component "use client" gets buried mid-file where Next's RSC
  // compiler won't see it. Marking the whole bundle client is correct here —
  // this package is a UI component library, not server-only utilities.
  banner: { js: '"use client";' },
});
