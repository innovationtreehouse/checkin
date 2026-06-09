import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './globals.css';
import type { Metadata } from 'next';
import { ColorSchemeScript, MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import AuthProvider from '@/components/AuthProvider';
import { EnvProvider } from '@/components/EnvProvider';
import OnboardingGate from '@/components/OnboardingGate';
import AppFrame from '@/components/AppFrame';
import { theme } from '@/lib/theme';
import { config } from '@/lib/config';

// CHECKIN_ENV is read at runtime (the same image runs in prod/dev/local), so the root
// layout must render dynamically rather than baking a build-time value into static HTML.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'CheckMeIn Next',
  description: 'The Innovation Treehouse next-generation check-in system',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ColorSchemeScript defaultColorScheme="auto" />
      </head>
      <body>
        <MantineProvider theme={theme} defaultColorScheme="auto">
          <ModalsProvider>
            <Notifications />
            <EnvProvider value={config.checkinEnv()}>
              <AuthProvider>
                <OnboardingGate>
                  <AppFrame>{children}</AppFrame>
                </OnboardingGate>
              </AuthProvider>
            </EnvProvider>
          </ModalsProvider>
        </MantineProvider>
      </body>
    </html>
  );
}
