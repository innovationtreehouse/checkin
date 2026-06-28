"use client";

import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect } from "react";
import { Center, Loader, Stack, Text } from "@mantine/core";

type SettingsUser = { sysadmin?: boolean; boardMember?: boolean };

// Settings is sysadmin/board only. Gate here since these pages were moved out of
// /admin: the membership settings page self-gates nothing and relied on the admin layout.
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/");
    } else if (status === "authenticated") {
      const user = session?.user as SettingsUser;
      if (!user?.sysadmin && !user?.boardMember) router.push("/");
    }
  }, [status, session, router]);

  if (status === "loading") {
    return (
      <Center mih="60vh">
        <Stack align="center">
          <Loader />
          <Text>Verifying access...</Text>
        </Stack>
      </Center>
    );
  }

  const user = session?.user as SettingsUser;
  if (!session || (!user?.sysadmin && !user?.boardMember)) {
    return null;
  }

  return <>{children}</>;
}
