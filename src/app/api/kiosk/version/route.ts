import { NextResponse } from "next/server";
import { execSync } from "child_process";

// Cache it for the lifetime of this Node process
let cachedVersion: string | null = null;

export const dynamic = "force-dynamic";

export async function GET() {
  if (!cachedVersion) {
    try {
      if (process.env.VERCEL_GIT_COMMIT_SHA) {
        cachedVersion = process.env.VERCEL_GIT_COMMIT_SHA;
      } else {
        cachedVersion = execSync("git rev-parse HEAD").toString().trim();
      }
    } catch (e) {
      cachedVersion = "unknown-" + Date.now();
    }
  }

  return NextResponse.json({ version: cachedVersion });
}
