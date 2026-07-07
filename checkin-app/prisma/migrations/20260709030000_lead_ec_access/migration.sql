-- Read-access audit action. Used by the time-scoped lead emergency-contact view
-- (one READ/EmergencyContact AuditLog row per household a program lead views).
-- The new enum value is not referenced in this same migration, so ADD VALUE is
-- safe here. Additive/expand-only: no columns, no data touched, no index change.
ALTER TYPE "AuditAction" ADD VALUE 'READ';
