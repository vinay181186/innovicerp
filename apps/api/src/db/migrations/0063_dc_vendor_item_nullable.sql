-- Bug #13: a Delivery Challan generated from a Job-Work PO with a free-text
-- vendor or free-text line item (vendor_id / item_id NULL — ADR-015 / ADR-012 #10)
-- could never be saved: the DC required a real FK for both. Make them FK-or-text
-- like the PO the DC is copied from. The vendor_code_text / item_code_text columns
-- stay NOT NULL, so a DC always carries a human-readable vendor and item even when
-- the FK is null. Loosening only — no existing row is affected.
ALTER TABLE public.delivery_challans ALTER COLUMN vendor_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE public.delivery_challan_lines ALTER COLUMN item_id DROP NOT NULL;
