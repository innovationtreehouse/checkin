import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { getLeadConflicts, type AttendanceConflict } from "@/lib/attendanceConflicts";

export type ConflictsResponse = { conflicts: AttendanceConflict[] };

// List overlapping-visit conflicts in the caller's led programs. Read-only; never
// mutates. Any signed-in user may call — getLeadConflicts scopes to their own led
// events and returns [] for non-leads, so there's nothing to leak.
export const GET = withAuth({}, async (_req, auth) => {
  if (auth.type !== "session") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const conflicts = await getLeadConflicts(auth.user.id);
  return NextResponse.json({ conflicts } satisfies ConflictsResponse);
});
