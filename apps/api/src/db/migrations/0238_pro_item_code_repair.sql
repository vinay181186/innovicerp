-- Production Orders saved the item's internal id as the Item Code when the plan
-- carried no item_code_text (createProductionOrder, fixed in the same change).
-- Put the real Item Master code back on those rows, and only those. A row whose
-- text is not its own item id is never touched, so a re-run changes nothing and
-- adds no second History row. One statement: the repair and its History entry
-- commit together.
WITH repaired AS (
  UPDATE public.production_orders po
  SET item_code_text = i.code
  FROM public.items i
  WHERE i.id = po.item_id
    AND po.item_code_text = po.item_id::text
  RETURNING po.id, po.company_id, po.code, i.code AS item_code
)
INSERT INTO public.activity_log (company_id, user_id, user_name, action, entity, entity_id, ref_id, detail)
SELECT r.company_id, NULL, 'System', 'EDIT', 'ProductionOrder', r.id, r.code,
       'Item Code repaired to ' || r.item_code || ' (a system id had been saved in its place)'
FROM repaired r;
