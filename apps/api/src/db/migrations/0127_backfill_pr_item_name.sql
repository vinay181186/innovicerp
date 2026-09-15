-- 0127 — backfill purchase_requests.item_name from the item master.
--
-- A PR raised from a rework/repair CHILD job card inherited the child's blank
-- item-name snapshot: item_id and item_code_text were stamped but item_name was
-- left NULL. The PO form fills its line name from pr.itemName, and its Create
-- button is gated on every line having a name — so "Gen PO" from such a PR
-- showed an empty item and a disabled Create button. createPurchaseRequest now
-- resolves the name from the master when the caller sends a link but no name;
-- this backfills the rows already saved with a null name.
--
-- Idempotent: fills only rows where item_name IS NULL and item_id names a live
-- master item. Re-running updates nothing. Apply to BOTH databases.

UPDATE public.purchase_requests pr
SET item_name = it.name,
    updated_at = now()
FROM public.items it
WHERE pr.item_id = it.id
  AND it.deleted_at IS NULL
  AND pr.deleted_at IS NULL
  AND (pr.item_name IS NULL OR pr.item_name = '')
  AND it.name IS NOT NULL
  AND it.name <> '';
