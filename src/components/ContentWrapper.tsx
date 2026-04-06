"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

function ContentWrapperInner({ children }: { children: React.ReactNode }) {

    const searchParams = useSearchParams();
    const isKioskMode = searchParams.get('mode') === 'kiosk' || searchParams.get('sig');

    useEffect(() => {
        if (isKioskMode) {
            document.body.classList.add('kiosk-mode');
        } else {
            document.body.classList.remove('kiosk-mode');
        }

        // Cleanup function to remove the class if the component unmounts
        // or if isKioskMode changes to false
        return () => {
            document.body.classList.remove('kiosk-mode');
        };
    }, [isKioskMode]);

    return (
        <div style={{ paddingTop: isKioskMode ? '0px' : '70px', minHeight: '100vh', cursor: isKioskMode ? 'none' : 'auto' }}>
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

