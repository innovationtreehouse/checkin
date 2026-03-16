"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./admin.module.css";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/");
    } else if (status === "authenticated") {
      const user = session?.user as {sysadmin?: boolean; boardMember?: boolean; keyholder?: boolean};
      const isAuthorizedGlobalAdmin = user?.sysadmin || user?.boardMember || user?.keyholder;
      const isProgramFlow = pathname?.startsWith("/admin/programs") || pathname?.match(/^\/admin\/events\/(\d+|new)/);

      if (!isAuthorizedGlobalAdmin && !isProgramFlow) {
        // Basic participants are NOT allowed in general admin areas
        router.push("/");
      } else if (user?.keyholder && !user?.sysadmin && !user?.boardMember && pathname !== "/admin/emergency-contacts" && !isProgramFlow) {
        // Keyholders who try to access other admin pages get sent to emergency contacts (unless they are doing program stuff)
        router.push("/admin/emergency-contacts");
      }
    }
  }, [status, session, router, pathname]);

  if (status === "loading") {
    return (
      <div className={styles.layout}>
        <div className="glass-container animate-float" style={{ margin: "auto" }}>
          <h2>Verifying Admin Access...</h2>
        </div>
      </div>
    );
  }

  const user = session?.user as {sysadmin?: boolean; boardMember?: boolean; keyholder?: boolean};
  const isProgramFlow = pathname?.startsWith("/admin/programs") || pathname?.match(/^\/admin\/events\/(\d+|new)/);

  if (!session || (!user?.sysadmin && !user?.boardMember && !user?.keyholder && !isProgramFlow)) {
    return null;
  }

  const navItems = [
    {
      title: "Dashboard",
      links: [{ name: "Dashboard", href: "/admin", icon: "📊" }],
    },
    {
      title: "Operations",
      links: [
        { name: "Visit History", href: "/admin/events/visits", icon: "🕒" },
        { name: "Raw Badge Events", href: "/admin/events/badges", icon: "📡" },
        { name: "Print ID Badges", href: "/admin/print-badges", icon: "🖨️" },
        { name: "Participation Trends", href: "/admin/trends", icon: "📈" },
        { name: "System Health", href: "/admin/systemhealth", icon: "🫀" },
      ],
    },
    {
      title: "People",
      links: [
        { name: "Participants", href: "/admin/participants", icon: "👥" },
        { name: "Merge Participants", href: "/admin/participants/merge", icon: "🔗" },
        { name: "Manage Memberships", href: "/admin/households", icon: "🏠" },
        { name: "Pending Participants", href: "/admin/programs/pending", icon: "⏳" },
        { name: "Emergency Contacts", href: "/admin/emergency-contacts", icon: "🚑" },
        { name: "Role Assignment", href: "/admin/roles", icon: "🔐" },
      ],
    },
  ];

  if (isProgramFlow) {
    return <>{children}</>;
  }

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <div className={styles.logo}>
          <span className="text-gradient">Admin Ops</span>
        </div>
        <nav>
          {navItems.map((section) => {
            const isStrictKeyholder = user?.keyholder && !user?.sysadmin && !user?.boardMember;
            const filteredLinks = isStrictKeyholder 
                ? section.links.filter(link => link.href === '/admin/emergency-contacts')
                : section.links;

            if (filteredLinks.length === 0) return null;

            return (
                <div key={section.title} className={styles.navSection}>
                <h3 className={styles.sectionTitle}>{section.title}</h3>
                {filteredLinks.map((link) => {
                    const isActive = pathname === link.href;
                    return (
                    <Link
                        key={link.href}
                        href={link.href}
                        className={`${styles.navLink} ${
                        isActive ? styles.activeLink : ""
                        }`}
                    >
                        <span className={styles.icon}>{link.icon}</span>
                        <span className={styles.linkText}>{link.name}</span>
                    </Link>
                    );
                })}
                </div>
            );
          })}
        </nav>
      </aside>
      <main className={styles.content}>{children}</main>
    </div>
  );
}
