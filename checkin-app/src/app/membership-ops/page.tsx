import { redirect } from "next/navigation";
import { MEMBERSHIP_OPS_NAV_LINKS } from "@/lib/membershipOpsNav";

export default function MembershipOpsIndex() {
  // Tabs live in the layout now; the hub has no landing content of its own.
  redirect(MEMBERSHIP_OPS_NAV_LINKS[0].href);
}
