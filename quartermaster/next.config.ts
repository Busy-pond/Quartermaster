import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Product images come from many retailer CDNs, so plain <img> tags are used instead of next/image.
  poweredByHeader: false,
  // Lets pages load through a cloudflared quick tunnel in dev (webhook testing) without cross-origin warnings.
  allowedDevOrigins: ["*.trycloudflare.com"],
  // A check build can use its own folder (NEXT_DIST_DIR=.next-check) so it doesn't overwrite a running dev server's .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
