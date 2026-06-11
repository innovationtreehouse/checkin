import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: 'standalone',
  // Deps hoist to the repo-root node_modules and future @checkin/* packages live
  // in ../packages. Point standalone file tracing at the repo root so it follows
  // those symlinks and bundles the linked code into the image (otherwise Next
  // infers the app dir as the trace root and ships dangling symlinks).
  outputFileTracingRoot: path.join(__dirname, '..'),
};

export default nextConfig;

// Force dev server reload for Prisma schema updates
