import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@auth/prisma-adapter'],
};

export default nextConfig;

// Force dev server reload for Prisma schema updates
