"use client";

import { Center, Loader } from "@mantine/core";
import { AuditLogPanel } from "@/components/admin/AuditLogPanel";
import { useRequireRole } from "@/hooks/useRequireRole";

export default function SystemStatusAuditLogPage() {
  // Audit Log is sysadmin-only; boardMembers reaching this URL directly are bounced.
  const { loading, ready } = useRequireRole(["sysadmin"], { redirectTo: "/system-status/health" });

  if (loading) {
    return (
      <Center mih="40vh">
        <Loader />
      </Center>
    );
  }
  if (!ready) return null;

  return <AuditLogPanel />;
}
