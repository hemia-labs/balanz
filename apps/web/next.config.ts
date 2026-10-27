import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // PM2 keeps using next start until the container cutover is approved.
  output: process.env.BALANZ_CONTAINER_BUILD === "true" ? "standalone" : undefined,
  outputFileTracingRoot: path.join(__dirname, "../.."),
};

export default nextConfig;
