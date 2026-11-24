import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the Turbopack workspace root to this folder. Without it Next 16
  // walks up the tree looking for lockfiles and picks the wrong one when
  // a stray package-lock.json sits at /Users/ogazboiz/code/hackathon/.
  // `import.meta.dirname` resolves to the directory containing this file,
  // which is exactly the frontend root we want.
  turbopack: {
    root: import.meta.dirname,
  },
  // Let Vatar (Lagos Life) embed GameArena in its "worlds" iframe. Vatar requires
  // a frame-ancestors CSP that names its domains and NO X-Frame-Options DENY/
  // SAMEORIGIN; 'self' keeps any same-origin framing working. Applied site-wide
  // because the registered game URL is the platform root.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self' https://lagoslife.app https://www.lagoslife.app",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
