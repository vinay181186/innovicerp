-- Route cards are born at revision 0, not 1 — the first edit is what makes a
-- card Rev 1. Both create paths in route-cards/service.ts already pass the
-- value explicitly, so this default is belt-and-braces: it exists so a third
-- copy of the number does not sit in the database saying "1".
--
-- Deliberately NO backfill. The six cards that already exist keep the numbers
-- they were created with (IN-RC-00001 at Rev 3, the rest at Rev 1) — the user
-- asked for the change to apply to new cards only.
alter table public.route_cards
  alter column current_revision set default 0;
