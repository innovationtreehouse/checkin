import { NextResponse } from "next/server";
import { SERVER_VERSION } from "@/lib/server-version";

export const dynamic = "force-dynamic";

export function GET() {
    return NextResponse.json({ version: SERVER_VERSION });
}
