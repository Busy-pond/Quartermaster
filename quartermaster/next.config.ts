import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Product images come from many retailer CDNs, so plain <img> tags are used instead of next/image.
  poweredByHeader: false,
  // Lets pages load through a cloudflared quick tunnel in dev (webhook testing) without cross-origin warnings.
  allowedDevOrigins: ["*.trycloudflare.com"],
};

export default nextConfig;
