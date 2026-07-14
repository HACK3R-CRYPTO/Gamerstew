import type { MetadataRoute } from "next";

const APP_URL = "https://gamearenahq.xyz";

// Sitemap · lists the public, crawlable pages so search engines discover and
// index them. Auth-gated surfaces (profile, settings, mint) are intentionally
// left out — they have nothing useful to rank and just dilute the crawl.
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const routes: { path: string; priority: number; freq: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
    { path: "/", priority: 1.0, freq: "daily" },
    { path: "/games", priority: 0.9, freq: "weekly" },
    { path: "/leaderboard", priority: 0.8, freq: "daily" },
    { path: "/home", priority: 0.7, freq: "weekly" },
    { path: "/privacy", priority: 0.3, freq: "yearly" },
    { path: "/terms", priority: 0.3, freq: "yearly" },
  ];
  return routes.map((r) => ({
    url: `${APP_URL}${r.path}`,
    lastModified: now,
    changeFrequency: r.freq,
    priority: r.priority,
  }));
}
