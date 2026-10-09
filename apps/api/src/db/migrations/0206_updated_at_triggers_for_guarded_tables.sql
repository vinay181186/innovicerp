-- ADR-226 (review finding) — the four guarded tables that had no
-- `set_updated_at` trigger, so §20.4's version check rested on every service
-- remembering to stamp the column by hand.
--
-- Found by the adversarial review of ADR-226. `apps/api/src/lib/edit-conflict.ts`
-- states the precondition outright: "Every table checked here must bump
-- updated_at on every UPDATE." Nine of the thirteen guarded tables get that from
-- a trigger (users 0001, machines/operators 0003, job_cards 0005,
-- goods_receipt_notes 0010, qc_processes 0011, nc_register + delivery_challans
-- 0012, saved_reports 0014). These four never had one:
--
--   customer_dispatches   tpi_masters   cost_centers   user_access
--
-- Their update services DO stamp `updatedAt: new Date()` — verified on every
-- update path before this migration was written, so the guard works today. But
-- "it works because four services each remember" is not a guarantee, it is a
-- thing to forget. Two paths already forget it: `softDeleteCostCenter` and
-- `softDeleteTpiMaster` set `{...softDeleteStamp(user), updatedBy}` with no
-- `updatedAt`. Harmless, because a deleted row 404s on edit so there is no
-- version to race over — but it is the same omission one line away from
-- mattering.
--
-- With the trigger in place the column moves whether or not the writer thought
-- about it, and a future writer of these four tables cannot silently disable
-- the check for a row.
--
-- A trigger and a hand-set `updatedAt` together are not a conflict: the trigger
-- is BEFORE UPDATE and overwrites NEW.updated_at, so the explicit value is
-- simply replaced by now(). Both produce "later than the token", which is all
-- the check reads. The services keep their stamps; belt and braces, and it
-- keeps them correct on a database restored without triggers.
--
-- `public.set_updated_at()` already exists (0001_post_init.sql). Idempotent —
-- DROP IF EXISTS then CREATE, the same shape as 0003 / 0005 / 0010 / 0012.

DROP TRIGGER IF EXISTS customer_dispatches_set_updated_at ON public.customer_dispatches;
--> statement-breakpoint
CREATE TRIGGER customer_dispatches_set_updated_at
  BEFORE UPDATE ON public.customer_dispatches
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
DROP TRIGGER IF EXISTS tpi_masters_set_updated_at ON public.tpi_masters;
--> statement-breakpoint
CREATE TRIGGER tpi_masters_set_updated_at
  BEFORE UPDATE ON public.tpi_masters
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
DROP TRIGGER IF EXISTS cost_centers_set_updated_at ON public.cost_centers;
--> statement-breakpoint
CREATE TRIGGER cost_centers_set_updated_at
  BEFORE UPDATE ON public.cost_centers
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
DROP TRIGGER IF EXISTS user_access_set_updated_at ON public.user_access;
--> statement-breakpoint
CREATE TRIGGER user_access_set_updated_at
  BEFORE UPDATE ON public.user_access
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
