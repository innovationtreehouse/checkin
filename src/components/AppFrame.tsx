"use client";

import { Suspense } from 'react';
import {
  ActionIcon,
  AppShell,
  Burger,
  Button,
  Group,
  NavLink,
  Text,
  Title,
  Tooltip,
  useMantineColorScheme,
  useComputedColorScheme,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconCalendarEvent,
  IconClipboardList,
  IconHome,
  IconLogout,
  IconMoon,
  IconSettings,
  IconSun,
  IconTool,
  IconUser,
} from '@tabler/icons-react';
import { useSession, signIn, signOut } from 'next-auth/react';
import { usePathname, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { brand } from '@/brand';
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
  icon: React.ReactNode;
  visible: (user: SessionUser | undefined, signedIn: boolean) => boolean;
};

const NAV_ITEMS: NavItem[] = [
  { href: '/kioskdisplay', label: 'Attendance', icon: <IconClipboardList size={18} />, visible: (_u, signedIn) => signedIn },
  { href: '/household', label: 'My Household', icon: <IconHome size={18} />, visible: (_u, signedIn) => signedIn },
  { href: '/programs', label: 'Programs', icon: <IconCalendarEvent size={18} />, visible: () => true },
  {
    href: '/shop',
    label: 'Shop Ops',
    icon: <IconTool size={18} />,
    visible: (u) =>
      !!u?.sysadmin ||
      !!u?.boardMember ||
      !!u?.shopSteward ||
      !!u?.toolStatuses?.some((ts) => ts.level === 'MAY_CERTIFY_OTHERS'),
  },
  {
    href: '/admin',
    label: 'Admin Ops',
    icon: <IconSettings size={18} />,
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

  // A colored sidebar (brand.nav.sidebar set) ⇒ white nav text + filled active pills.
  const onColoredSidebar = !!brand.nav.sidebar;

  const brandEl = (
    <Link href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
      {brand.logo ? (
        <Image src={brand.logo.src} alt={brand.logo.alt} width={brand.logo.width} height={brand.logo.height} priority />
      ) : (
        <Title order={3} c={`${brand.nav.accent}.7`}>
          {isDevInstance ? `${brand.appName}-dev` : brand.appName}
        </Title>
      )}
      {brand.logo && isDevInstance && <Text size="xs" c="dimmed" fw={700}>dev</Text>}
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
            {brandEl}
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
        <AppShell.Navbar p="md" bg={brand.nav.sidebar}>
          {visibleItems.map((item) => {
            const active = isActive(pathname, item.href);
            const onSidebarText = onColoredSidebar && !active ? 'var(--mantine-color-white)' : undefined;
            return (
              <NavLink
                key={item.href}
                component={Link}
                href={item.href}
                label={item.label}
                leftSection={item.icon}
                active={active}
                variant={onColoredSidebar ? 'filled' : 'light'}
                color={brand.nav.accent}
                onClick={closeMobile}
                mb={4}
                styles={{
                  root: { borderRadius: 'var(--mantine-radius-md)' },
                  label: { color: onSidebarText, fontWeight: 600 },
                  section: { color: onSidebarText },
                }}
              />
            );
          })}
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
