import { NextResponse } from 'next/server';
import { config } from '@/lib/config';

export async function GET() {
    // Lets a deploy assert the ops-stg access gate is actually live, rather than
    // trusting the task-def env var was set correctly (see config.ts isStaging()).
    return NextResponse.json({ status: "ok", staging: config.isStaging() });
}
