-- Board-configurable email sender identity (overrides the EMAIL_FROM env default;
-- adds an optional Reply-To). Both nullable, no default — a safe additive change
-- on a populated table.
ALTER TABLE "BoardSettings" ADD COLUMN "emailFromAddress" TEXT;
ALTER TABLE "BoardSettings" ADD COLUMN "emailReplyToAddress" TEXT;
