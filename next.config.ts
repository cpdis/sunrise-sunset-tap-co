import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // PGlite loads its WASM and data files from its own package folder at runtime, which breaks when bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
