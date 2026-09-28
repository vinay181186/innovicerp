-- ============================================================
-- 0154_item_types.sql  (ADR-193 phase 1b)
--
-- Item Type is chosen when an item is created (owner decision Q2). Three new
-- types join component / assembly:
--   raw_material — issued against a Job Card as its raw material
--   consumable   — issued for general use, kept by reorder level
--   tool         — handed out and returned (tool / instrument register)
-- Existing items keep their type; the owner reclassifies by editing the item.
-- Idempotent. Apply to BOTH the test and the production database.
-- Rollback: enum values cannot be dropped; unused values are harmless.
-- ============================================================

ALTER TYPE public.item_type ADD VALUE IF NOT EXISTS 'raw_material';
--> statement-breakpoint
ALTER TYPE public.item_type ADD VALUE IF NOT EXISTS 'consumable';
--> statement-breakpoint
ALTER TYPE public.item_type ADD VALUE IF NOT EXISTS 'tool';
