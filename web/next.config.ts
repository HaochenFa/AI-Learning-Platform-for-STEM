import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Supports classroom material uploads up to the app-level 20MB limit.
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
