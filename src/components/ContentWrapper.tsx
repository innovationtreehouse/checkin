"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function ContentWrapperInner({ children }: { children: React.ReactNode }) {

    const searchParams = useSearchParams();
    const isKioskMode = searchParams.get('mode') === 'kiosk' || searchParams.get('sig');

    return (
        <div style={{ paddingTop: isKioskMode ? '0px' : '70px', minHeight: '100vh', cursor: isKioskMode ? 'none' : 'auto' }}>
            {isKioskMode && (
                <style dangerouslySetInnerHTML={{ __html: `
                    body, * { cursor: none !important; }
                `}} />
            )}
            {children}
        </div>
    );
}

export default function ContentWrapper({ children }: { children: React.ReactNode }) {
    return (
        <Suspense fallback={<div style={{ paddingTop: '70px', minHeight: '100vh' }}>{children}</div>}>
            <ContentWrapperInner>{children}</ContentWrapperInner>
        </Suspense>
    );
}

