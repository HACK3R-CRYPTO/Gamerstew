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
};

export default nextConfig;
