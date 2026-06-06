-- 0054: companies.email — letterhead footer e-mail printed on outward docs
-- (PO / Service PO / OSP DC / JW DC / Invoice). Additive, no data touched.
-- Visual spec: Screen shots/Innovic.docx letterhead footer (2026-06-06).

ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "email" text;
