-- ============================================================
-- 0147_po_tax_type_none_to_null
--
-- The PO form offered two "no tax" choices: "— None —" (saved NULL) and
-- "None" (saved the string 'none'). The form now offers ONE option, "None",
-- stored as NULL. This folds the old 'none' / blank values into NULL so every
-- untaxed PO reads the same.
--
-- Data only; no schema change. Tax amounts are unaffected: the form already
-- zeroes SGST/CGST/IGST % whenever the tax type is not SGST+CGST / IGST.
--
-- ROLLBACK: not needed ('none' and NULL both mean no tax type).
-- Idempotent. Apply to BOTH the test and the production database.
-- ============================================================

UPDATE purchase_orders SET tax_type = NULL WHERE tax_type IN ('none', '');
