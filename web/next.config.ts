import type { NextConfig } from "next";
import path from "node:path";

/**
 * `outputFileTracingRoot` is pinned because the repo root also has a
 * package-lock.json (the Phase 1 spike scripts), and Next would otherwise
 * guess the wrong workspace root.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname),
  // The floating dev badge sits over the bottom-left of the hero, which is
  // exactly where the headline is. Off, so design review sees the real thing.
  devIndicators: false,
};

export default nextConfig;
