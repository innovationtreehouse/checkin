"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Center, Loader } from "@mantine/core";
import { defaultShopTab, shopRoles } from "@/lib/shopNav";

/**
 * /shop has no content of its own — it redirects to the role-appropriate tab.
 * Client-side because the default depends on the session (admin→create,
 * certifier→manage, else→live). The layout enforces access.
 */
export default function ShopOpsIndex() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated") {
      router.replace(defaultShopTab(shopRoles(session?.user)));
    }
  }, [status, session, router]);

  return (
    <Center mih="60vh">
      <Loader />
    </Center>
  );
}
