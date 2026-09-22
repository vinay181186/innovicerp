-- 0137 — a Plan records the CUSTOMER DISPATCH DATE: the day the goods must
-- leave for the customer, entered when the plan is created (defaulted from the
-- SO line's due date). It flows downstream — the Production Order's target
-- date pre-fills from it, the Job Card header shows it, and the Customer
-- Dispatch pending list works to it. Nullable: older plans and JW-sourced
-- plans have none. Idempotent.
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS customer_dispatch_date date;
