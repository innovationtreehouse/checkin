'use client';

import { usePathname, useSearchParams } from 'next/navigation';

/**
 * Hook to determine if the application is currently in "kiosk mode".
 * Kiosk mode is active if:
 * 1. The 'mode' search parameter is set to 'kiosk'.
 * 2. The 'sig' search parameter is present.
 * 3. The current path starts with '/kioskdisplay'.
 */
export function useKioskMode() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const isKioskMode =
    searchParams?.get('mode') === 'kiosk' ||
    searchParams?.has('sig') ||
    (pathname?.startsWith('/kioskdisplay') ?? false);

  return isKioskMode;
}
