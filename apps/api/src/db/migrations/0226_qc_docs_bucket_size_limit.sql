-- ============================================================
-- 0226_qc_docs_bucket_size_limit
-- Attachment limit 50 MB (owner 2026-10-28). Until now only the browser
-- checked file size (10 MB); the `qc-docs` bucket had no limit of its own
-- ("Unset") and took the project ceiling. This puts 50 MB on the bucket so
-- Storage refuses a bigger file even when the screen is bypassed. Same
-- number as ATTACHMENT_MAX_BYTES in packages/shared/src/schemas/attachment.ts.
--
-- allowed_mime_types is deliberately left NULL: the bucket also holds
-- drawings (CAD files often arrive as application/octet-stream), item
-- images, client PO files and task files — a type list here would refuse
-- some of them. File types are checked by each screen.
--
-- Idempotent. Rollback: SET file_size_limit = NULL (back to the project
-- ceiling, 50 MB on PROD). Apply to BOTH test and production (release script).
-- ============================================================

UPDATE storage.buckets SET file_size_limit = 52428800 WHERE id = 'qc-docs';
