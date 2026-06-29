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
  IconActivity,
  IconAdjustments,
  IconBriefcase,
  IconBuildingWarehouse,
  IconCalendarEvent,
  IconClipboardList,
  IconCoin,
  IconHome,
  IconList,
  IconLogout,
  IconMoon,
  IconSettings,
  IconShieldCheck,
  IconSun,
  IconTool,
  IconUser,
  IconUsers,
  IconUserSearch,
} from '@tabler/icons-react';
import { useSession, signIn, signOut } from 'next-auth/react';
import { usePathname, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { brand } from '@/brand';
import { useIsDevInstance } from '@/components/EnvProvider';
import { BuildInfoFooter } from '@/components/BuildInfoFooter';
import { useTodoCounts } from '@/hooks/useTodoCounts';
import { useConfirmNav } from '@/components/UnsavedChangesProvider';
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
  { href: '/my-household', label: 'My Household', icon: <IconHome size={18} />, visible: (_u, signedIn) => signedIn },
  {
    href: '/safety',
    label: 'Safety',
    icon: <IconShieldCheck size={18} />,
    visible: (u) => !!u?.sysadmin || !!u?.boardMember || !!u?.keyholder,
  },
  { href: '/my-activities', label: 'My Activities', icon: <IconActivity size={18} />, visible: (_u, signedIn) => signedIn },
  { href: '/attendance', label: 'Attendance', icon: <IconClipboardList size={18} />, visible: (_u, signedIn) => signedIn },
  { href: '/programs', label: 'Programs', icon: <IconCalendarEvent size={18} />, visible: () => true },
  {
    href: '/shop-ops',
    label: 'Shop Ops',
    icon: <IconTool size={18} />,
    visible: (u) =>
      !!u?.sysadmin ||
      !!u?.boardMember ||
      !!u?.toolStatuses?.some((ts) => ts.level === 'MAY_CERTIFY_OTHERS'),
  },
  {
    href: '/facility-ops',
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
    href: '/membership-audit',
    label: 'Membership Audit',
    icon: <IconUserSearch size={18} />,
    visible: (u) => !!u?.sysadmin || !!u?.boardMember,
  },
  {
    href: '/program-ops',
    label: 'Program Ops',
    icon: <IconBriefcase size={18} />,
    visible: (u) => !!u?.sysadmin || !!u?.boardMember,
  },
  {
    href: '/finance-ops',
    label: 'Finance Ops',
    icon: <IconCoin size={18} />,
    visible: (u) => !!u?.sysadmin || !!u?.boardMember,
  },
  {
    href: '/system-status',
    label: 'System Status',
    icon: <IconSettings size={18} />,
    visible: (u) => !!u?.sysadmin || !!u?.boardMember,
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: <IconAdjustments size={18} />,
    visible: (u) => !!u?.sysadmin || !!u?.boardMember,
  },
  { href: '/index', label: 'Index', icon: <IconList size={18} />, visible: (_u, signedIn) => signedIn },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

type NavBadge = { count: number; color: string; label: string };

/**
 * The badge for a nav item, or null when nothing to show. Green = action the
 * viewer must take; gray = live informational count (occupancy, running programs).
 */
function navBadgeFor(href: string, counts: TodoCounts | null): NavBadge | null {
  if (!counts) return null;
  const green = (n: number, label: string): NavBadge | null =>
    n > 0 ? { count: n, color: 'treehouseGreen', label } : null;
  const gray = (n: number, label: string): NavBadge | null =>
    n > 0 ? { count: n, color: 'gray', label } : null;
  switch (href) {
    case '/my-household':
      return green(counts.member.household.length, `${counts.member.household.length} items need attention`);
    case '/attendance':
      return gray(counts.building, `${counts.building} people currently in the building`);
    case '/programs':
      return gray(counts.activePrograms, `${counts.activePrograms} active programs`);
    case '/membership-ops':
      // Pending membership applications awaiting board review.
      return green(counts.admin ? counts.admin.membership : 0, 'Pending membership reviews');
    case '/membership-audit': {
      // Gray: gaps the household must close, not the board — missing emergency
      // contacts plus accounts created at registration but never claimed.
      const total = counts.admin ? counts.admin.householdsMissingContact + counts.admin.unclaimedHouseholds : 0;
      return gray(total, 'Households missing an emergency contact or with an unclaimed account');
    }
    case '/finance-ops':
      // Pending participants awaiting payment-plan approval.
      return green(counts.admin ? counts.admin.programsPending : 0, 'Pending payment-plan approvals');
    case '/safety':
      // Trusted-adult disclosures awaiting board review.
      return green(counts.admin ? counts.admin.trustedAdults : 0, 'Trusted-adult disclosures to review');
    // System Status has no badge: every count it could show (membership,
    // payment-plan, trusted-adult) belongs to another nav item that already
    // badges it. A roll-up here just duplicates those numbers under an
    // unrelated label.
    default:
      return null;
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
  const confirmNav = useConfirmNav();
  // Shared chokepoint for every in-app link in the frame: if the current page has
  // unsaved edits and the user declines the confirm, cancel the navigation.
  const guardNav = (e: { preventDefault: () => void }) => {
    if (!confirmNav()) e.preventDefault();
  };
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
    <Link href="/" onNavigate={guardNav} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
      {brand.logo ? (
        <Image src={brand.logo.src} alt={brand.logo.alt} width={brand.logo.width} height={brand.logo.height} priority />
      ) : (
        <Title order={3} c={`${brand.nav.accent}.7`}>
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
        onNavigate={guardNav}
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
        <AppShell.Navbar
          p="md"
          bg={brand.nav.sidebar}
          // On the dark sidebar, Mantine's hover fill for non-active items is the near-white
          // `default-hover` token, which left white labels invisible (white-on-white, #284).
          // Scope that token to a translucent white so hovering just lightens the purple and the
          // white label stays readable — and it works in dark mode too, unlike a fixed color.
          style={
            onColoredSidebar
              ? ({ '--mantine-color-default-hover': 'rgba(255, 255, 255, 0.12)' } as React.CSSProperties)
              : undefined
          }
        >
          {visibleItems.map((item) => {
            const active = isActive(pathname, item.href);
            // On the colored sidebar all text is white; the 'light' variant gives a soft
            // translucent overlay on the active item rather than a harsh solid fill.
            const sidebarText = onColoredSidebar ? 'var(--mantine-color-white)' : undefined;
            const badge = navBadgeFor(item.href, todoCounts);
            return (
              <NavLink
                key={item.href}
                component={Link}
                href={item.href}
                onNavigate={guardNav}
                label={item.label}
                leftSection={item.icon}
                rightSection={
                  badge ? (
                    <Badge
                      size="md"
                      color={badge.color}
                      variant="filled"
                      aria-label={badge.label}
                    >
                      {badge.count}
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
