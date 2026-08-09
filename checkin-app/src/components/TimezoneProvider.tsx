"use client";

import { setDisplayTimezone } from '@/lib/time';

/**
 * Installs the organisation's configured display timezone (AppSettings.timezone) for the
 * instant formatters in lib/time, which client components call as plain functions from
 * render bodies, memos and callbacks alike.
 *
 * A provider rather than a prop: the formatters are called from leaf components all over
 * the tree, most of them client pages with no server parent to thread a prop from. The
 * value is installed during render, not in an effect, so children — including their
 * server-rendered first pass — format in the configured zone from the start rather than
 * flashing the fallback.
 */
export function TimezoneProvider({ value, children }: { value: string; children: React.ReactNode }) {
    setDisplayTimezone(value);
    return <>{children}</>;
}
