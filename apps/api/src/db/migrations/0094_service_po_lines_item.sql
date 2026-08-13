-- 0094 — Service PO lines get an Item Master link.
--
-- The line grid used to be a single free-text "Description" column. It now reads
-- Item Code (master-only picker) → Item Name (auto-fetched from the master), per
-- the system-wide item-picker rule in docs/CONVENTIONS.md.
--
-- `description` is RENAMED to `item_name` so existing rows keep their text (they
-- simply have no item_id / item_code_text — they predate the master link).
-- Idempotent: each step is guarded so a re-run is a no-op.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'service_po_lines' and column_name = 'description'
  ) and not exists (
    select 1 from information_schema.columns
    where table_name = 'service_po_lines' and column_name = 'item_name'
  ) then
    alter table service_po_lines rename column description to item_name;
  end if;
end $$;
--> statement-breakpoint
alter table service_po_lines add column if not exists item_id uuid references items(id);
--> statement-breakpoint
alter table service_po_lines add column if not exists item_code_text text;
--> statement-breakpoint
create index if not exists service_po_lines_item_idx on service_po_lines (item_id);
--> statement-breakpoint
-- Backfill: every existing line's old free text is in fact an Item Master code
-- (all 4 live rows hold '554117146000' = LEVER CATCH RAMMER), so link them and
-- replace the text with the master name. Only touches rows still unlinked.
update service_po_lines l
set item_id = i.id,
    item_code_text = i.code,
    item_name = i.name
from items i
where i.company_id = l.company_id
  and i.deleted_at is null
  and upper(i.code) = upper(l.item_name)
  and l.item_id is null;
