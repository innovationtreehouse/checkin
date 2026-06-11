"use client";

import { createContext, useContext } from 'react';
import type { CheckinEnv } from '@/lib/config';

/**
 * Carries the server's CHECKIN_ENV into client components.
 *
 * CHECKIN_ENV is server-only (not NEXT_PUBLIC_), so client code cannot read it from
 * process.env. The root layout (a server component) reads it at request time and feeds
 * it in here; client components consume it via the hooks below instead of config.isDev.
 */
const CheckinEnvContext = createContext<CheckinEnv>('prod');

export function EnvProvider({
    value,
    children,
}: {
    value: CheckinEnv;
    children: React.ReactNode;
}) {
    return <CheckinEnvContext.Provider value={value}>{children}</CheckinEnvContext.Provider>;
}

export function useCheckinEnv(): CheckinEnv {
    return useContext(CheckinEnvContext);
}

/** True on the cloud dev instance OR a local laptop (i.e. not prod). */
export function useIsDevInstance(): boolean {
    return useContext(CheckinEnvContext) !== 'prod';
}

/** True only on a developer laptop — gates offline credential login UI. */
export function useIsLocalInstance(): boolean {
    return useContext(CheckinEnvContext) === 'local';
}
