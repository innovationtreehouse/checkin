"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useSession, signIn, signOut } from "next-auth/react";
import { ORG_DOMAIN } from "@/lib/config";
import { useCheckinEnv, useIsDevInstance } from "@/components/EnvProvider";

// Layout for the glass hero (this page still uses the legacy glass-* utilities, not Mantine).
// Inlined from the former page.module.css, which the Mantine migration removed.
const mainStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "calc(100vh - 70px)",
    padding: "2rem 1rem",
};
const heroStyle: React.CSSProperties = {
    maxWidth: 600,
    width: "100%",
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
};

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
    const checkinEnv = useCheckinEnv();
    const callbackUrl = params.get("callbackUrl") || "/";
    const error = params.get("error");

    const signedIn = status === "authenticated" && !!session?.user;
    // The same org gate the dev middleware enforces (hd + verified email). Only a session that
    // actually FAILS it gets the "wrong account" treatment — a verified org member can also land
    // here (e.g. a persona-mint that was refused redirects back with ?error=), and telling them
    // their account isn't in the Workspace would be wrong on both counts. The gate only exists on
    // the cloud dev instance; local sessions never carry the hd claim.
    const orgVerified = session?.user?.hd === ORG_DOMAIN && session?.user?.emailVerified === true;
    const wrongAccount = signedIn && checkinEnv === "dev" && !orgVerified;

    return (
        <main style={mainStyle}>
            <div className="glass-container animate-float" style={heroStyle}>
                <h1 className="text-gradient" style={{ fontSize: "3rem", margin: "0 0 0.5rem 0", fontFamily: "var(--mantine-font-family-headings)" }}>
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
                            Signed in as <strong>{session.user?.email}</strong>, but this Google account is not
                            managed by the <code>@{ORG_DOMAIN}</code> Google Workspace — it may be a personal
                            account or a forwarding alias. Sign out and use an actual{" "}
                            <code>@{ORG_DOMAIN}</code> Workspace account to access the dev environment.
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
                ) : signedIn ? (
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
                        {error && (
                            <div
                                style={{
                                    width: "100%",
                                    padding: "1rem",
                                    background: "rgba(245, 158, 11, 0.12)",
                                    border: "1px solid rgba(245, 158, 11, 0.4)",
                                    borderRadius: 12,
                                    color: "#fcd34d",
                                    fontSize: "0.95rem",
                                }}
                            >
                                That sign-in attempt didn&apos;t complete (code: <code>{error}</code>).
                                You are still signed in as <strong>{session.user?.email}</strong>.
                            </div>
                        )}
                        <a
                            className="glass-button"
                            href={callbackUrl}
                            style={{
                                width: "100%",
                                background: "rgba(59, 130, 246, 0.2)",
                                borderColor: "rgba(59, 130, 246, 0.4)",
                            }}
                        >
                            Continue as {session.user?.name || session.user?.email}
                        </a>
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
