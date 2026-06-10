"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useSession, signIn, signOut } from "next-auth/react";
import { ORG_DOMAIN } from "@/lib/config";
import { useIsDevInstance } from "@/components/EnvProvider";
import styles from "../page.module.css";

/**
 * Custom sign-in screen for the dev instance (replaces NextAuth's bare default page). The dev
 * middleware (DEV_INSTANCE_DESIGN.md §4) bounces every anonymous request here, and a signed-in but
 * non-org account lands here too (it can't pass the `hd` gate) — so this page covers both states.
 * Styled to match the real homepage hero.
 */
function SignInInner() {
    const params = useSearchParams();
    const { data: session, status } = useSession();
    const isDevInstance = useIsDevInstance();
    const callbackUrl = params.get("callbackUrl") || "/";

    // Signed in but routed here = a valid Google login that isn't an org member (failed the hd gate).
    const wrongAccount = status === "authenticated" && !!session?.user;

    return (
        <main className={styles.main}>
            <div className={`glass-container animate-float ${styles.heroContainer}`}>
                <h1 className="text-gradient" style={{ fontSize: "3rem", margin: "0 0 0.5rem 0" }}>
                    {isDevInstance ? "Welcome to Innovation Treehouse Dev" : "CheckMeIn"}
                </h1>
                <p style={{ color: "var(--color-text-muted)", fontSize: "1.1rem", marginBottom: "2rem" }}>
                    {isDevInstance
                        ? <>Log in with an <strong>@{ORG_DOMAIN}</strong> email below.</>
                        : "The Innovation Treehouse check-in system."}
                </p>

                {wrongAccount ? (
                    <div
                        style={{
                            width: "100%",
                            maxWidth: 360,
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: "1rem",
                        }}
                    >
                        <div
                            style={{
                                width: "100%",
                                padding: "1rem",
                                background: "rgba(239, 68, 68, 0.12)",
                                border: "1px solid rgba(239, 68, 68, 0.4)",
                                borderRadius: 12,
                                color: "#fca5a5",
                                fontSize: "0.95rem",
                            }}
                        >
                            <strong>{session.user?.email}</strong> isn&apos;t an <code>@{ORG_DOMAIN}</code>{" "}
                            account, so it can&apos;t access the dev environment.
                        </div>
                        <button
                            className="glass-button"
                            onClick={() => signOut({ callbackUrl: "/signin" })}
                            style={{
                                width: "100%",
                                background: "rgba(59, 130, 246, 0.2)",
                                borderColor: "rgba(59, 130, 246, 0.4)",
                            }}
                        >
                            Sign out &amp; use another account
                        </button>
                    </div>
                ) : (
                    <div
                        style={{
                            width: "100%",
                            maxWidth: 360,
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: "1.25rem",
                        }}
                    >
                        <button
                            className="glass-button primary-button"
                            onClick={() => signIn("google", { callbackUrl })}
                            style={{
                                width: "100%",
                                padding: "1rem 2rem",
                                fontSize: "1.2rem",
                                background: "rgba(59, 130, 246, 0.2)",
                                borderColor: "rgba(59, 130, 246, 0.4)",
                            }}
                        >
                            Sign in with Google
                        </button>
                    </div>
                )}
            </div>
        </main>
    );
}

export default function SignInPage() {
    // useSearchParams requires a Suspense boundary in the app router.
    return (
        <Suspense fallback={null}>
            <SignInInner />
        </Suspense>
    );
}
