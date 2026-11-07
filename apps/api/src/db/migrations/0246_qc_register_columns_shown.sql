-- ADR-285 — keep the QC Call Register's Operation and Stage, and Created On and
-- Created Time on every list, on screen for everybody once they can be hidden.
--
-- Those columns were locked or shown by default, and a saved `hidden = true` on
-- them was ignored by the lock. Now they become hideable, an old saved row would
-- take effect and the column would vanish with nobody having asked for that
-- today (owner, ADR-285). So those saved rows are set back to shown.
--
-- Operation (and Stage on Completed) were hidden by default, not by choice, and
-- the owner wants them on screen. Stage on Pending was already shown by default,
-- so a saved hide there is a real choice and stays.
--
-- Left out: activity-log, party-materials, stock-counts and tool-issues. There
-- Created On is an ordinary column, hidden by default and never locked, so a saved
-- hidden is a real choice.
--
-- Data only, no structure changes. Only `hidden` moves, and only to false, so
-- user_table_columns_not_pinned_and_hidden cannot be violated. The
-- user_table_columns_set_updated_at trigger stamps updated_at. Safe to re-run:
-- a second run finds no row.
--
-- ROLLBACK: none needed, each user can hide the column again.

UPDATE public.user_table_columns SET hidden = false
WHERE hidden AND ((column_key IN ('created_on','created_time')
    AND table_key NOT IN ('activity-log','party-materials','stock-counts','tool-issues'))
  OR (table_key IN ('qc-call-pending','qc-call-completed','incoming-qc-call-pending','incoming-qc-call-completed') AND column_key = 'operation')
  OR (table_key IN ('qc-call-completed','incoming-qc-call-completed') AND column_key = 'stage'));
