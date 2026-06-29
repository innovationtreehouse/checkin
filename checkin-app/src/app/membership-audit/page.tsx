import { redirect } from "next/navigation";

export default function MembershipAuditIndex() {
  // Tabs live in the layout; the hub redirects to the first tool.
  redirect("/membership-audit/emergency-contacts");
}
