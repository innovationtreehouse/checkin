"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Alert, Button, Card, Center, Container, Loader, Tabs, Title } from "@mantine/core";
import { ScrollableTabsList } from "@/components/ui/ScrollableTabsList";
import { useConfirmNav } from "@/components/UnsavedChangesProvider";
import { SHOP_NAV_LINKS, shopRoles } from "@/lib/shopNav";

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const confirmNav = useConfirmNav();

  useEffect(() => {
    if (status === "unauthenticated") router.push("/");
  }, [status, router]);

  if (status === "loading") {
    return (
      <Center mih="60vh">
        <Loader />
      </Center>
    );
  }

  if (status === "unauthenticated") return null;

  const roles = shopRoles(session?.user);

  // General access gate (admin ⊂ certifier), mirroring the original page.
  if (!roles.isCertifier) {
    return (
      <Container size="sm" py="xl">
        <Card withBorder radius="md" padding="xl">
          <Title order={2} mb="sm">Access Denied</Title>
          <Alert color="red" mb="md">
            Forbidden: You require the Admin, Board Member, or Certifier role to view this page.
          </Alert>
          <Button onClick={() => router.push("/")}>Back to Home</Button>
        </Card>
      </Container>
    );
  }

  const visibleLinks = SHOP_NAV_LINKS.filter((link) => link.visible(roles));
  const active = visibleLinks.find((link) => pathname === link.href)?.href ?? null;

  // Per-tab gate: a known shop tab the viewer may not see (e.g. /shop/create for
  // a non-admin certifier hitting the URL directly).
  const onHiddenTab =
    SHOP_NAV_LINKS.some((link) => link.href === pathname) && !active;
  if (onHiddenTab) {
    return (
      <Container size="sm" py="xl">
        <Card withBorder radius="md" padding="xl">
          <Title order={2} mb="sm">Access Denied</Title>
          <Alert color="red" mb="md">You do not have access to this section.</Alert>
          <Button onClick={() => router.push("/shop-ops")}>Back to Shop Operations</Button>
        </Card>
      </Container>
    );
  }

  return (
    <Container size="lg" pb="md">
      <Tabs
        value={active}
        onChange={(value) => {
          if (value && value !== active && confirmNav()) router.push(value);
        }}
        mb="md"
      >
        <ScrollableTabsList>
          {visibleLinks.map((link) => (
            <Tabs.Tab key={link.href} value={link.href} leftSection={<span>{link.icon}</span>}>
              {link.name}
            </Tabs.Tab>
          ))}
        </ScrollableTabsList>
      </Tabs>

      {children}
    </Container>
  );
}
