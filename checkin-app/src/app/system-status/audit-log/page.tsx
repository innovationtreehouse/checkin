"use client";


import { AuditLogPanel } from "@/components/admin/AuditLogPanel";
import { useRequireRole } from "@/hooks/useRequireRole";

import { PageLoader } from "@/components/ui/PageLoader";
export default function SystemStatusAuditLogPage() {
  // Audit Log is isSysadmin-only; boardMembers reaching this URL directly are bounced.
  const { loading, ready } = useRequireRole(["isSysadmin"], { redirectTo: "/system-status/health" });

  if (loading) {
    return (
      <PageLoader minHeight="40vh" />
    );
  }
  if (!ready) return null;

  return <AuditLogPanel />;
}
