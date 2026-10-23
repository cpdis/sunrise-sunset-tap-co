import type { NextConfig } from "next";
import { INDEXABLE } from "./lib/indexable";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The header also covers what a meta tag can't: images, video, the OG image and API responses.
  async headers() {
    return INDEXABLE ? [] : [{ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] }];
  },
};

export default nextConfig;
