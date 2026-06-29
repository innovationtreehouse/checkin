/**
 * Single source of truth for the Membership Ops tools. Rendered as the top tab
 * bar in membership-ops/layout.tsx; the hub (/membership-ops) redirects to the
 * first entry. Add a tool once here and it shows up as a tab.
 */
export interface MembershipOpsNavLink {
  name: string;
  href: string;
  icon: string;
  description?: string;
}

export const MEMBERSHIP_OPS_NAV_LINKS: MembershipOpsNavLink[] = [
  { name: "Participants", href: "/membership-ops/participants", icon: "👥", description: "Browse and manage participant profiles." },
  // HIDDEN: "Merge Participants" is unlinked until the merge API reconciles join-table
  // collisions instead of blind-deleting the merge-side row.
  // The merge route (src/app/api/membership-ops/participants/merge/route.ts, lines 82-145) resolves
  // unique-key collisions on join tables by blind-deleting the merge-side row, ignoring which
  // row holds better data. When both participants have a row on the same key this silently
  // downgrades data:
  //   - toolStatus: keep=BASIC + merge=MAY_CERTIFY_OTHERS -> higher cert destroyed, survivor
  //     left at BASIC (safety/tool-access regression).
  //   - programParticipant: keep=PENDING + merge=ACTIVE -> active enrollment reverted to PENDING.
  //   - feePayment / rsvp: merge-side payment metadata (customNote, shopifyLink,
  //     quickBooksInvoice, paidOn) and RSVP status dropped.
  // Correct fix reconciles the two rows (higher cert level, ACTIVE over PENDING, the row with
  // payment metadata) instead of deleting the merge-side row. Until that lands the feature is
  // hidden so admins cannot silently corrupt certification/enrollment data via a merge. Page and
  // API route are kept intact. See it.failing cases ("should keep the HIGHER" / "should keep the
  // ACTIVE") in src/app/api/membership-ops/participants/merge/__tests__/route.integration.test.ts.
  // { name: "Merge Participants", href: "/membership-ops/participants/merge", icon: "🔗", description: "Combine duplicate participant records." },
  { name: "Manage Memberships", href: "/membership-ops/households", icon: "🏠", description: "Grant or revoke household facility membership." },
  { name: "Volunteer Memberships", href: "/membership-ops/volunteer-memberships", icon: "🙋", description: "Designate volunteer-only emails for reduced dues." },
  { name: "Membership Applications", href: "/membership-ops/applications", icon: "📋", description: "Review and approve membership applications." },
  // "Unclaimed Accounts" moved to Membership Audit (/membership-audit/unclaimed).
  { name: "Background-check Review", href: "/membership-ops/review", icon: "🔍", description: "Review submitted membership background checks." },
];
