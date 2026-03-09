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
      const isAuthorized =
        (session?.user as {sysadmin?: boolean; boardMember?: boolean})?.sysadmin || (session?.user as {sysadmin?: boolean; boardMember?: boolean})?.boardMember;
      if (!isAuthorized) {
        router.push("/");
      }
    }
  }, [status, session, router]);

  if (status === "loading") {
    return (
      <div className={styles.layout}>
        <div className="glass-container animate-float" style={{ margin: "auto" }}>
          <h2>Verifying Admin Access...</h2>
        </div>
      </div>
    );
  }

  if (!session || (!(session.user as {sysadmin?: boolean; boardMember?: boolean})?.sysadmin && !(session.user as {sysadmin?: boolean; boardMember?: boolean})?.boardMember)) {
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
      ],
    },
    {
      title: "People",
      links: [
        { name: "Participants", href: "/admin/participants", icon: "👥" },
        { name: "Manage Memberships", href: "/admin/households", icon: "🏠" },
        { name: "Role Assignment", href: "/admin/roles", icon: "🔐" },
      ],
    },
  ];

  const isProgramFlow = pathname?.startsWith("/admin/programs") || pathname?.match(/^\/admin\/events\/(\d+|new)/);

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
          {navItems.map((section) => (
            <div key={section.title} className={styles.navSection}>
              <h3 className={styles.sectionTitle}>{section.title}</h3>
              {section.links.map((link) => {
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
          ))}
        </nav>
      </aside>
      <main className={styles.content}>{children}</main>
    </div>
  );
}
