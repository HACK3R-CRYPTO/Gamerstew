import type { MetadataRoute } from "next";

const APP_URL = "https://gamearenahq.xyz";

// Robots · let search engines crawl everything public, keep them out of the
// API and per-user surfaces, and point them at the sitemap.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/settings", "/profile", "/verify", "/connect"],
    },
    sitemap: `${APP_URL}/sitemap.xml`,
    host: APP_URL,
  };
}
