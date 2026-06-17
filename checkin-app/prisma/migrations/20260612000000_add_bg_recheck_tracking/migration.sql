-- Board-configurable background-check re-check interval. Expiry/freshness is derived
-- from Participant.lastBackgroundCheck + this interval (see householdBgIsFresh); nothing
-- is denormalized onto Participant.

-- How long a check stays valid, in months. 0 = not yet configured.
ALTER TABLE "BoardSettings" ADD COLUMN "bgRecheckMonths" INTEGER NOT NULL DEFAULT 0;
