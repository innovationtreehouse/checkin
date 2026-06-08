import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: number;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      sysadmin?: boolean;
      keyholder?: boolean;
      boardMember?: boolean;
      shopSteward?: boolean;
      backgroundCheckReviewer?: boolean;
      householdId?: number | null;
      householdLead?: boolean;
      toolStatuses?: { toolId: number; level: string }[];
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
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: number;
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
