import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: number;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      // Household membership is DENIED — login is blocked; all role flags are forced false.
      denied?: boolean;
      sysadmin?: boolean;
      keyholder?: boolean;
      boardMember?: boolean;
      shopSteward?: boolean;
      backgroundCheckReviewer?: boolean;
      householdId?: number | null;
      householdLead?: boolean;
      toolStatuses?: { toolId: number; level: string }[];
      // Inert impersonation provenance — display/audit only, never read by authz.
      impersonatedBy?: string | null;
      // Org-gate claims surfaced for the dev-instance server-action fence (assertDevActor).
      // Not secrets — anyone able to load the dev app is already org-verified by the middleware.
      hd?: string | null;
      emailVerified?: boolean;
    };
  }

  interface User {
    id: number | string;
    sysadmin?: boolean;
    keyholder?: boolean;
    boardMember?: boolean;
    shopSteward?: boolean;
    backgroundCheckReviewer?: boolean;
    householdId?: number | null;
    householdLead?: boolean;
    toolStatuses?: { toolId: number; level: string }[];
    // Set by the persona-mint provider; carried into the JWT by the jwt callback.
    impersonatedBy?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: number;
    // Household membership is DENIED — login is blocked; all role flags are forced false.
    denied?: boolean;
    // Google hosted-domain + email_verified claims, used by the dev-instance org-login gate.
    hd?: string | null;
    emailVerified?: boolean;
    // Inert impersonation provenance — display/audit only, never read by authz.
    impersonatedBy?: string | null;
    sysadmin?: boolean;
    keyholder?: boolean;
    boardMember?: boolean;
    shopSteward?: boolean;
    backgroundCheckReviewer?: boolean;
    householdId?: number | null;
    householdLead?: boolean;
    toolStatuses?: { toolId: number; level: string }[];
  }
}
