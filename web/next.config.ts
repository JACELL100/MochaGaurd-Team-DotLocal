import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets CI/local verification use an isolated build folder without disturbing a running dev server.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
