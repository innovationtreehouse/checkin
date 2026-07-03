-- Soft-hide: let a household permanently hide a withdrawn trusted adult from
-- their own /mine view. Row is kept (board history / audit); nullable timestamp,
-- default absent = visible. Board & sysadmin views ignore this flag.
ALTER TABLE "TrustedAdult" ADD COLUMN "hiddenAt" TIMESTAMP(3);
