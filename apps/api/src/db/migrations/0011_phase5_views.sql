-- ============================================================
-- 0011_phase5_views
-- v_item_stock — per-item stock balance derived from
-- store_transactions (ADR-015 #11). Avoids the
-- items.stock_qty denormalisation legacy used.
--
-- `adjust` rows are treated as positive — current data has none,
-- and signed adjustments would be modelled by emitting two rows
-- (one `out`, one `in`) rather than a single signed `adjust`.
-- Revisit if the first real adjustment proves us wrong.
--
-- View is RLS-respecting because store_transactions has RLS
-- enabled — an authenticated query against v_item_stock will
-- only see rows from the user's company.
-- ============================================================

CREATE OR REPLACE VIEW public.v_item_stock AS
SELECT
  st.company_id,
  st.item_id,
  SUM(CASE
        WHEN st.txn_type = 'in'  THEN  st.qty
        WHEN st.txn_type = 'out' THEN -st.qty
        ELSE st.qty
      END)::integer AS on_hand_qty
FROM public.store_transactions st
WHERE st.item_id IS NOT NULL
GROUP BY st.company_id, st.item_id;
