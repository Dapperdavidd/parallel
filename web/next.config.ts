import type { NextConfig } from "next";
import path from "node:path";

/**
 * `distDir` is overridable so a production build never writes into the running
 * dev server's `.next`. They share that directory by default, and a build will
 * replace the chunks the dev server is serving — the page then 404s
 * `main-app.js`, stops hydrating, and throws
 * "Cannot read properties of undefined (reading 'call')" until a hard reload.
 * It looks like an application bug and is not one.
 *
 *   npm run build   ->  builds into .next-build, dev keeps running
 *
 * `outputFileTracingRoot` is pinned because the repo root also has a
 * package-lock.json, which Next would otherwise take as the workspace root.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname),
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // The dev badge sits over the hero headline.
  devIndicators: false,
};

export default nextConfig;
