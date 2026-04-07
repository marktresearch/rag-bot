import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@llamaindex/liteparse", "pdf-parse", "canvas", "sharp"],
};

export default nextConfig;
