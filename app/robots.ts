import type { MetadataRoute } from "next";
import { INDEXABLE, PRIVATE_PATHS } from "@/lib/indexable";

export default function robots(): MetadataRoute.Robots {
  return {
    // Before launch nothing is disallowed: crawlers must fetch pages to see their noindex and drop them.
    rules: { userAgent: "*", allow: "/", ...(INDEXABLE ? { disallow: PRIVATE_PATHS } : {}) },
  };
}
