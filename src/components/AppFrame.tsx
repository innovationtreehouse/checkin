"use client";

import { Suspense } from 'react';
import {
  ActionIcon,
  AppShell,
  Burger,
  Button,
  Group,
  NavLink,
  Title,
  Tooltip,
  useMantineColorScheme,
  useComputedColorScheme,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconLogout, IconMoon, IconSun, IconUser } from '@tabler/icons-react';
import { useSession, signIn, signOut } from 'next-auth/react';
import { usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useIsDevInstance } from '@/components/EnvProvider';

type SessionUser = {
  sysadmin?: boolean;
  boardMember?: boolean;
  shopSteward?: boolean;
  toolStatuses?: Array<{ level: string }>;
};

type NavItem = {
  href: string;
  label: string;
  visible: (user: SessionUser | undefined, signedIn: boolean) => boolean;
};

const NAV_ITEMS: NavItem[] = [
  { href: '/kioskdisplay', label: 'Attendance', visible: (_u, signedIn) => signedIn },
  { href: '/household', label: 'My Household', visible: (_u, signedIn) => signedIn },
  { href: '/programs', label: 'Programs', visible: () => true },
  {
    href: '/shop',
    label: 'Shop Ops',
    visible: (u) =>
      !!u?.sysadmin ||
      !!u?.boardMember ||
      !!u?.shopSteward ||
      !!u?.toolStatuses?.some((ts) => ts.level === 'MAY_CERTIFY_OTHERS'),
  },
  {
    href: '/admin',
    label: 'Admin Ops',
    visible: (u) => !!u?.sysadmin || !!u?.boardMember,
  },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function ColorSchemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme('light', { getInitialValueInEffect: true });
  const isDark = computed === 'dark';
  return (
    <Tooltip label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}>
      <ActionIcon
        variant="subtle"
        color="gray"
        size="lg"
        aria-label="Toggle color scheme"
        onClick={() => setColorScheme(isDark ? 'light' : 'dark')}
      >
        {isDark ? <IconSun size={18} /> : <IconMoon size={18} />}
      </ActionIcon>
    </Tooltip>
  );
}

function AppFrameInner({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isDevInstance = useIsDevInstance();
  const [mobileOpened, { toggle: toggleMobile, close: closeMobile }] = useDisclosure(false);

  // Kiosk mode (mode=kiosk param or valid cert signature present): render full-screen,
  // no app chrome, cursor hidden — preserves the unattended Raspberry-Pi board behavior.
  const isKioskMode = searchParams.get('mode') === 'kiosk' || !!searchParams.get('sig');
  if (isKioskMode) {
    return <div style={{ minHeight: '100vh', cursor: 'none' }}>{children}</div>;
  }

  const signedIn = !!session;
  const user = session?.user as SessionUser | undefined;
  // Faithful to the old NavBar: no navigation on the homepage when signed out.
  const showNav = !(!signedIn && pathname === '/');

  const visibleItems = NAV_ITEMS.filter((item) => item.visible(user, signedIn));

  const brand = (
    <Link href="/" style={{ textDecoration: 'none' }}>
      <Title order={3} c="blue">
        {isDevInstance ? 'CMI-dev' : 'CheckMeIn'}
      </Title>
    </Link>
  );

  const authButtons = signedIn ? (
    <>
      <Button
        component={Link}
        href="/profile"
        variant="subtle"
        leftSection={<IconUser size={16} />}
      >
        My Profile
      </Button>
      <Button
        color="red"
        variant="light"
        leftSection={<IconLogout size={16} />}
        onClick={() => signOut({ callbackUrl: '/' })}
      >
        Sign Out
      </Button>
    </>
  ) : (
    <Button onClick={() => signIn('google')}>Sign In To Dashboard</Button>
  );

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={
        showNav
          ? { width: 260, breakpoint: 'sm', collapsed: { mobile: !mobileOpened } }
          : undefined
      }
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            {showNav && (
              <Burger opened={mobileOpened} onClick={toggleMobile} hiddenFrom="sm" size="sm" />
            )}
            {brand}
          </Group>
          <Group gap="xs" wrap="nowrap" visibleFrom="sm">
            <ColorSchemeToggle />
            {authButtons}
          </Group>
          <Group hiddenFrom="sm">
            <ColorSchemeToggle />
          </Group>
        </Group>
      </AppShell.Header>

      {showNav && (
        <AppShell.Navbar p="md">
          {visibleItems.map((item) => (
            <NavLink
              key={item.href}
              component={Link}
              href={item.href}
              label={item.label}
              active={isActive(pathname, item.href)}
              onClick={closeMobile}
            />
          ))}
          <Group mt="md" hiddenFrom="sm" grow>
            {authButtons}
          </Group>
        </AppShell.Navbar>
      )}

      <AppShell.Main>{children}</AppShell.Main>
    </AppShell>
  );
}

export default function AppFrame({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh' }}>{children}</div>}>
      <AppFrameInner>{children}</AppFrameInner>
    </Suspense>
  );
}
