import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXUS_STUDIO_DIST_DIR || ".next",
  output: "standalone",
  poweredByHeader: false,
};

export default nextConfig;
