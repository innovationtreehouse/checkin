-- Board disposal of abandoned membership applications, modeled as a terminal
-- status (like ACTIVE/BLOCKED) rather than a parallel flag — so "is this
-- application live?" stays a single declarative status check. Additive enum
-- value; no columns, no data touched, no index change (ARCHIVED is simply
-- absent from the in-flight status set the partial unique index gates on).
ALTER TYPE "OrgMembershipProcessStatus" ADD VALUE 'ARCHIVED';
