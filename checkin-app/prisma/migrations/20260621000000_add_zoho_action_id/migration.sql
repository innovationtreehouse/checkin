-- Embedded Zoho Sign signing needs the recipient's action id (alongside the
-- existing request id in zohoEnvelopeId) to mint per-session embed tokens. The
-- signing request/document is created once and these two ids are stored so it is
-- never re-created. Additive, nullable column — no backfill.
ALTER TABLE "MembershipProcess" ADD COLUMN "zohoActionId" TEXT;
