import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Product images come from many retailer CDNs, so plain <img> tags are used instead of next/image.
  poweredByHeader: false,
};

export default nextConfig;
