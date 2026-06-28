import type { Session } from "next-auth";

/**
 * Single source of truth for the Shop Ops tabs. Rendered as the persistent top
 * tabs (shop/layout.tsx); /shop itself redirects to the role-appropriate tab.
 *
 * Tabs are role-gated, so unlike facilityNav each link carries a `visible`
 * predicate over the viewer's resolved roles.
 */
export interface ShopRoles {
  /** Sysadmin or Board Member — may create tools and see all assignments. */
  isAdmin: boolean;
  /** Admin, or explicitly holds MAY_CERTIFY_OTHERS — may grant certifications. */
  isCertifier: boolean;
}

export interface ShopNavLink {
  name: string;
  href: string;
  icon: string;
  visible: (roles: ShopRoles) => boolean;
}

export const SHOP_NAV_LINKS: ShopNavLink[] = [
  { name: "Create Tool", href: "/shop/create", icon: "✨", visible: (r) => r.isAdmin },
  { name: "Manage Tools & Certifications", href: "/shop/manage", icon: "📋", visible: (r) => r.isCertifier },
  { name: "Live Certifications Center", href: "/shop/live", icon: "📊", visible: () => true },
];

export function shopRoles(user: Session["user"] | undefined): ShopRoles {
  const isAdmin = !!user?.sysadmin || !!user?.boardMember;
  const isCertifier =
    isAdmin || !!user?.toolStatuses?.some((ts) => ts.level === "MAY_CERTIFY_OTHERS");
  return { isAdmin, isCertifier };
}

/** Landing tab for /shop, preserving the original role-based default. */
export function defaultShopTab(roles: ShopRoles): string {
  return roles.isAdmin ? "/shop/create" : roles.isCertifier ? "/shop/manage" : "/shop/live";
}
