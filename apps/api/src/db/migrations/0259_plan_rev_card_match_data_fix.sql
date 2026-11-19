-- 0259 — one-time PROD data fix (owner approved 19-Nov-2026): five open plans
-- read "No Route Card" on the dashboard although their item has a Route Card,
-- because the plan carries NO Drawing Rev while the card is for Rev 0. The
-- owner's call: keep the card's Rev. Each plan's order line already says "0"
-- (JWSO lines) or the part comes from SO-441's BOM; the card is the item's only
-- one. So the plan is linked to the card's Rev 0 record, and the three JWSO
-- lines whose Rev text is '0' are linked to the same record (as 0256 did), so a
-- new plan from those lines takes Rev 0 by itself.
--
--   PLN-0097  01031473                  IN-RC-00083  IN-JW-00015 line 1
--   PLN-0175  05CTOSTO79814898115-2009  IN-RC-00088  IN-JW-00025 line 2
--   PLN-0185  MSColumn_Magnus           IN-RC-00087  IN-JW-00032 line 1
--   PLN-0199  559904110000              IN-RC-00090  SO-441 BOM part
--   PLN-0201  559904112000              IN-RC-00093  SO-441 BOM part (Rev 0 is a Draft drawing)
--
-- Every UPDATE is guarded on today's values (Rev link blank, same item, the
-- card still on that Rev, no Production Order on the plan), so a second run, a
-- changed row, or the TEST database (no such rows) changes nothing and only
-- raises a NOTICE. Not touched: SO-441 line 1, the BOM, the cards' approval.
-- Undo: set item_revision_id back to NULL on the plan and JWSO line ids below.
DO $$
DECLARE
  v_company constant uuid := 'd997c3ed-3496-49b6-a54d-6e9ea9d50548';
  r record;
  n integer;
BEGIN
  PERFORM 1 FROM public.plans
   WHERE id = '7ad4a3c7-b76f-4401-bdbe-65c8af032db1' AND company_id = v_company;
  IF NOT FOUND THEN
    RAISE NOTICE '0259: these plans are not on this database - nothing to do';
    RETURN;
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      ('PLN-0097', '7ad4a3c7-b76f-4401-bdbe-65c8af032db1'::uuid, '109d5535-be52-4238-a368-3db1cce08ae8'::uuid,
       'IN-RC-00083', 'fcd8e683-5783-484f-9571-b92559ca7ad6'::uuid, 'ae8902a9-a75c-4133-8d97-9c5a0c448dcd'::uuid,
       '3c87035a-103c-4c5a-be2d-8159c22603b4'::uuid),
      ('PLN-0175', '49605008-6031-468b-956a-3eb7676527f4'::uuid, '51a4ec15-5075-4ceb-83cd-f7a106355f53'::uuid,
       'IN-RC-00088', '95a0be10-3bf5-4361-92e2-ce722724147e'::uuid, 'd68e979d-224c-4c00-8560-c605111686cc'::uuid,
       '529c3875-7f51-4f05-9cea-5d11c1430fc8'::uuid),
      ('PLN-0185', '2df2fd07-b591-40d2-abc4-146a51184a31'::uuid, '02513f70-a9ea-4658-ab26-f076a445a205'::uuid,
       'IN-RC-00087', 'f8d06cdf-6802-4f22-83b5-81f80b97c86f'::uuid, '8fbdd9b7-8c6c-4df2-9909-2e5252b1330f'::uuid,
       'b04ec900-0345-48a6-85fd-d016f41cbc55'::uuid),
      ('PLN-0199', '7f8bf70a-47c8-4797-ad27-4cf61f876771'::uuid, 'e286caa6-7ae2-4360-9968-d51ea60e5e7c'::uuid,
       'IN-RC-00090', '08e68f10-969a-4924-b645-c24f6bd88649'::uuid, '9d1f12f5-7e9c-40f0-81bf-5c42657ae0ef'::uuid,
       NULL::uuid),
      ('PLN-0201', '7ba37367-d7eb-47f0-a803-39d791787f01'::uuid, 'f0d9e7fb-6882-4e2c-a7d3-44f0852a5a74'::uuid,
       'IN-RC-00093', 'fa91c134-ad72-4241-94f0-b94330372f9a'::uuid, '9502b1b1-d756-429c-b067-fe0942545112'::uuid,
       NULL::uuid)
    ) AS t(plan_code, plan_id, item_id, rc_code, rc_id, rev_id, jw_line_id)
  LOOP
    -- The card must still be this item's live card on that Rev 0 record.
    PERFORM 1 FROM public.route_cards rc
      JOIN public.item_revisions ir ON ir.id = rc.item_revision_id
     WHERE rc.id = r.rc_id AND rc.item_id = r.item_id AND rc.item_revision_id = r.rev_id
       AND rc.deleted_at IS NULL AND ir.item_id = r.item_id AND ir.rev = '0' AND ir.deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE NOTICE '0259: % - % is no longer a Rev 0 card for this item - skipped', r.plan_code, r.rc_code;
      CONTINUE;
    END IF;

    UPDATE public.plans p
       SET item_revision_id = r.rev_id, updated_at = now()
     WHERE p.id = r.plan_id AND p.company_id = v_company AND p.item_id = r.item_id
       AND p.item_revision_id IS NULL AND p.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.production_orders po
                        WHERE po.plan_id = p.id AND po.deleted_at IS NULL);
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE '0259: % rows %', r.plan_code, n;
    IF n = 1 THEN
      INSERT INTO public.activity_log (company_id, user_name, action, entity, detail, ref_id, entity_id, reason)
      VALUES (v_company, 'system (data fix 0259)', 'EDIT', 'Plan',
              'Drawing Rev — → 0 (match ' || r.rc_code || ')', r.plan_code, r.plan_id,
              'Plan had no Drawing Rev, its Route Card is Rev 0; owner-approved data fix 19-Nov-2026');
    END IF;

    IF r.jw_line_id IS NOT NULL THEN
      UPDATE public.job_work_order_lines
         SET item_revision_id = r.rev_id, updated_at = now()
       WHERE id = r.jw_line_id AND company_id = v_company AND item_id = r.item_id
         AND revision = '0' AND item_revision_id IS NULL;
      GET DIAGNOSTICS n = ROW_COUNT;
      RAISE NOTICE '0259: % JWSO line rows %', r.plan_code, n;
    END IF;
  END LOOP;
END $$;
