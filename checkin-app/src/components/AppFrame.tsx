"use client";

import { Suspense } from 'react';
import {
  ActionIcon,
  AppShell,
  Badge,
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
import {
  IconBuildingWarehouse,
  IconCalendarEvent,
  IconClipboardList,
  IconCoin,
  IconHome,
  IconLogout,
  IconMoon,
  IconSettings,
  IconShieldCheck,
  IconSun,
  IconTool,
  IconUser,
  IconUsers,
} from '@tabler/icons-react';
import { useSession, signIn, signOut } from 'next-auth/react';
import { usePathname, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { brand } from '@/brand';
import { useIsDevInstance } from '@/components/EnvProvider';
import { BuildInfoFooter } from '@/components/BuildInfoFooter';
import { useTodoCounts } from '@/hooks/useTodoCounts';
import type { TodoCounts } from '@/app/api/nav/todo-counts/route';

type SessionUser = {
  sysadmin?: boolean;
  boardMember?: boolean;
  keyholder?: boolean;
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
      !!u?.toolStatuses?.some((ts) => ts.level === 'MAY_CERTIFY_OTHERS'),
  },
  {
    href: '/facility',
    label: 'Facility Ops',
    icon: <IconBuildingWarehouse size={18} />,
    visible: (u) => !!u?.sysadmin || !!u?.boardMember,
  },
  {
    href: '/membership-ops',
    label: 'Membership Ops',
    icon: <IconUsers size={18} />,
    visible: (u) => !!u?.sysadmin || !!u?.boardMember,
  },
  {
    href: '/finance-ops',
    label: 'Finance Ops',
    icon: <IconCoin size={18} />,
    visible: (u) => !!u?.sysadmin || !!u?.boardMember,
  },
  {
    href: '/safety',
    label: 'Safety',
    icon: <IconShieldCheck size={18} />,
    visible: (u) => !!u?.sysadmin || !!u?.boardMember || !!u?.keyholder,
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

/** Todo-count badge value for a nav item, or 0 when nothing is due / unknown. */
function todoCountFor(href: string, counts: TodoCounts | null): number {
  if (!counts) return 0;
  switch (href) {
    case '/household':
      return counts.member.household.length;
    case '/programs':
      return counts.member.programs.length;
    case '/membership-ops':
      // Pending membership applications awaiting board review.
      return counts.admin ? counts.admin.membership : 0;
    case '/finance-ops':
      // Pending participants awaiting payment-plan approval.
      return counts.admin ? counts.admin.programsPending : 0;
    case '/safety':
      // Trusted-adult disclosures awaiting board review.
      return counts.admin ? counts.admin.trustedAdults : 0;
    case '/admin':
      // Top-level roll-up of the board's queue; per-queue badges live in the admin sub-nav.
      return counts.admin
        ? counts.admin.membership + counts.admin.programsPending + counts.admin.trustedAdults
        : 0;
    default:
      return 0;
  }
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
  // Fetch before any early return so the hook order stays stable (rules of hooks).
  const todoCounts = useTodoCounts(!!session);

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
        <Title order={3} tt="lowercase" c={`${brand.nav.accent}.7`}>
          {brand.appName}
        </Title>
      )}
      {isDevInstance && (
        <Badge color="orange" variant="filled" size="sm" radius="sm" aria-label="Development environment">
          DEV
        </Badge>
      )}
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
      footer={{ height: 28 }}
      navbar={
        showNav
          ? { width: 260, breakpoint: 'sm', collapsed: { mobile: !mobileOpened } }
          : undefined
      }
      padding="md"
    >
      <AppShell.Header
        style={isDevInstance ? { borderBottom: '3px solid var(--mantine-color-orange-6)' } : undefined}
      >
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
            // On the colored sidebar all text is white; the 'light' variant gives a soft
            // translucent overlay on the active item rather than a harsh solid fill.
            const sidebarText = onColoredSidebar ? 'var(--mantine-color-white)' : undefined;
            const todoCount = todoCountFor(item.href, todoCounts);
            return (
              <NavLink
                key={item.href}
                component={Link}
                href={item.href}
                label={item.label}
                leftSection={item.icon}
                rightSection={
                  todoCount > 0 ? (
                    <Badge
                      size="xs"
                      color="treehouseGreen"
                      variant="filled"
                      aria-label={`${todoCount} item${todoCount === 1 ? '' : 's'} need attention`}
                    >
                      {todoCount}
                    </Badge>
                  ) : undefined
                }
                active={active}
                variant="light"
                color={brand.nav.accent}
                onClick={closeMobile}
                mb={4}
                styles={{
                  root: { borderRadius: 'var(--mantine-radius-md)' },
                  label: { color: sidebarText, fontWeight: 600 },
                  section: { color: sidebarText },
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

      <AppShell.Footer>
        <BuildInfoFooter />
      </AppShell.Footer>
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
