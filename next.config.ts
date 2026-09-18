import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // These packages use Node APIs (fs, workers) and should not be bundled by Next.
  serverExternalPackages: ["vectra", "unpdf"],
};

export default nextConfig;
