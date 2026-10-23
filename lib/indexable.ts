// Search engines stay out until the real domain is live: the PoC takes simulated deposits, so a stranger must not find it.
// Set SITE_INDEXABLE=1 on the real domain's deployment only. Until then every response says noindex (meta tag and
// X-Robots-Tag header), and robots.txt still allows crawling, because a crawler that is disallowed never sees the noindex.
export const INDEXABLE = process.env.SITE_INDEXABLE === "1";

// Never worth indexing, even on the real domain.
export const PRIVATE_PATHS = ["/admin", "/api/", "/checkout", "/booking/", "/login"];
