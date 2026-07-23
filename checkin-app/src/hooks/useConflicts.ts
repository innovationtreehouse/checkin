"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { AttendanceConflict } from "@/lib/attendanceConflicts";
import type { ConflictsResponse } from "@/app/api/my-programs/conflicts/route";

// Shared snapshot so the subtab badge (layout) and the list (page) read one
// fetch, in lockstep. Mirrors useTodoCounts's module-store pattern.
let conflicts: AttendanceConflict[] | null = null;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function refreshConflicts() {
  if (inFlight) return;
  inFlight = fetch("/api/my-programs/conflicts")
    .then((res) => (res.ok ? (res.json() as Promise<ConflictsResponse>) : null))
    .then((data) => {
      if (data) {
        conflicts = data.conflicts;
        emit();
      }
    })
    .catch(() => {})
    .finally(() => {
      inFlight = null;
    });
}

/** Conflicts for the current lead, kept consistent across consumers. null until loaded / disabled. */
export function useConflicts(enabled: boolean): { conflicts: AttendanceConflict[] | null; refresh: () => void } {
  const subscribe = useCallback((onChange: () => void) => {
    listeners.add(onChange);
    return () => listeners.delete(onChange);
  }, []);
  const snapshot = useSyncExternalStore(subscribe, () => conflicts, () => null);

  useEffect(() => {
    if (enabled) refreshConflicts();
  }, [enabled]);

  return { conflicts: enabled ? snapshot : null, refresh: refreshConflicts };
}
