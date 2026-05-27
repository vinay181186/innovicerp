-- ============================================================
-- 0044_phase8_shift_general
-- Add 'general' to the `shift` enum so QC / TPI / Op-Entry shift dropdowns
-- offer Day / Night / General like legacy (renderQCDashboard L4171,
-- renderTPI L21415). Additive enum value; idempotent. Separate migration
-- because an added enum value cannot be USED in the same transaction that
-- adds it — nothing here uses it, so this is safe to apply standalone.
-- ============================================================

ALTER TYPE "shift" ADD VALUE IF NOT EXISTS 'general';
