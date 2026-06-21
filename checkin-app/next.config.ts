import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: 'standalone',
  // Deps hoist to the repo-root node_modules and future @checkin/* packages live
  // in ../packages. Point standalone file tracing at the repo root so it follows
  // those symlinks and bundles the linked code into the image (otherwise Next
  // infers the app dir as the trace root and ships dangling symlinks).
  outputFileTracingRoot: path.join(__dirname, '..'),
  // The membership-agreement PDF is read from disk at runtime (fs.readFile), not
  // imported, so Next's tracer won't bundle it on its own. Explicitly include the
  // assets dir for the sign route so the file ships in the standalone image.
  // (Dir is empty until the real agreement lands — issue #289.)
  outputFileTracingIncludes: {
    '/api/membership/contract/sign': ['./src/lib/membership/contract/assets/**'],
  },
};

export default nextConfig;

// Force dev server reload for Prisma schema updates
