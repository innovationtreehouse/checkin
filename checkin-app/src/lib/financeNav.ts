/**
 * Single source of truth for the Finance Ops tools. Rendered as the persistent
 * top tabs (finance-ops/layout.tsx); /finance-ops itself redirects to the first tab.
 */
export interface FinanceNavLink {
  name: string;
  href: string;
  icon: string;
  /** One-line description shown on the hub landing grid (not in the tabs). */
  description?: string;
}

export const FINANCE_NAV_LINKS: FinanceNavLink[] = [
  { name: "Pending Participants", href: "/finance-ops/pending", icon: "⏳", description: "Review and approve payment-plan requests." },
];
