import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import AuthProvider from '@/components/AuthProvider';
import { EnvProvider } from '@/components/EnvProvider';
import NavBar from '@/components/NavBar';
import OnboardingGate from '@/components/OnboardingGate';
import ContentWrapper from '@/components/ContentWrapper';
import { config } from '@/lib/config';

const inter = Inter({ subsets: ['latin'] });

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
    <html lang="en">
      <body className={inter.className}>
        <EnvProvider value={config.checkinEnv()}>
          <AuthProvider>
            <OnboardingGate>
              <NavBar />
              <ContentWrapper>
                {children}
              </ContentWrapper>
            </OnboardingGate>
          </AuthProvider>
        </EnvProvider>
      </body>
    </html>
  );
}

