/**
 * Single source of truth for the Finance Ops tools. Rendered as the persistent
 * top tabs (finance-ops/layout.tsx); /finance-ops itself redirects to the first tab.
 */
import type { NavLink } from "@/lib/nav/types";

export const FINANCE_NAV_LINKS: NavLink[] = [
  { name: "Payment Plan", href: "/finance-ops/payment-plan", icon: "⏳" },
];
