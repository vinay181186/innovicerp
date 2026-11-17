-- 0256 — one-time PROD data fix (owner approved 17-Nov-2026): PRO-58 / JC-26-00058
-- (BEARING BUSH FC01109875, JW-8 line 2) were made with NO Drawing Rev. The order
-- line says Rev 0. The Drawing Rev clean-up (16-Nov) set the item's only card
-- RC-43 to Rev HB1008529 (for JW-42) and made the Rev 0 card RC-97 (same 5 ops).
-- A Job Card save then made a new no-Rev card RC-99 (Pending) for JC-58.
--
-- This links JW-8 line 2, plan PLN-0025, PRO-58 and JC-26-00058 to Rev 0 and to
-- RC-97. Every UPDATE is guarded on today's values (Rev blank, nothing finished),
-- so a second run, a changed row, or the TEST database (no such rows) changes
-- nothing and only raises a NOTICE. RC-99 is rejected and trashed afterwards
-- through the app (audit + reason), not here.
-- Undo: set item_revision_id back to NULL on the four rows, PRO route card back
-- to RC-43 (c5255351-08e5-4ec9-893f-acd00114dd61, rev 1), JC route card back to
-- RC-99 (def4bcc8-ead0-40d3-ab4d-fa3b359af709, rev 0).
DO $$
DECLARE
  v_item   constant uuid := '1fe549f3-12e2-459a-a43b-e4ecf91a778e'; -- FC01109875
  v_rev0   constant uuid := '2fb830ea-2599-4412-aeb3-b591937930cc'; -- FC01109875 / Rev 0
  v_rc97   constant uuid := 'b867503a-666d-4b66-b191-d52c4d1e1bc3'; -- IN-RC-00097
  v_pro    constant uuid := '05bdec36-30f1-43f8-bb90-3be4e73a933c'; -- IN-PRO-00058
  v_jc     constant uuid := 'deae278f-6292-41e6-a40a-ec0e50eb5261'; -- IN-JC-26-00058
  v_plan   constant uuid := 'f3d4e7f6-18d8-455c-b95c-c9132d005789'; -- PLN-0025
  v_company uuid;
  v_rc97_rev integer;
  v_jw_line uuid;
  v_done integer;
  n integer;
BEGIN
  SELECT company_id INTO v_company FROM public.production_orders
   WHERE id = v_pro AND item_id = v_item AND deleted_at IS NULL;
  IF v_company IS NULL THEN
    RAISE NOTICE '0256: PRO-58 not on this database - nothing to do';
    RETURN;
  END IF;

  -- The Rev 0 record and RC-97 must be what the fix points to.
  PERFORM 1 FROM public.item_revisions
   WHERE id = v_rev0 AND item_id = v_item AND rev = '0' AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE NOTICE '0256: Rev 0 record missing - skipped'; RETURN; END IF;
  SELECT current_revision INTO v_rc97_rev FROM public.route_cards
   WHERE id = v_rc97 AND item_id = v_item AND item_revision_id = v_rev0
     AND approval_status = 'approved' AND deleted_at IS NULL;
  IF v_rc97_rev IS NULL THEN RAISE NOTICE '0256: RC-97 not an approved Rev 0 card - skipped'; RETURN; END IF;

  -- Nothing may have been made on JC-58 yet (no op has a completed piece).
  SELECT COALESCE(SUM(COALESCE(v.completed_qty, 0)), 0)
       + (SELECT COUNT(*) FROM public.running_ops r JOIN public.jc_ops o2 ON o2.id = r.jc_op_id
           WHERE o2.job_card_id = v_jc AND r.status = 'running')
    INTO v_done
    FROM public.jc_ops o LEFT JOIN public.v_jc_op_status v ON v.jc_op_id = o.id
   WHERE o.job_card_id = v_jc AND o.deleted_at IS NULL;
  IF v_done > 0 THEN RAISE NOTICE '0256: JC-58 has started (pieces done or running) - skipped'; RETURN; END IF;

  -- JW-8 line 2 (the PRO's plan line)
  SELECT p.jw_line_id INTO v_jw_line FROM public.plans p WHERE p.id = v_plan AND p.item_id = v_item;
  UPDATE public.job_work_order_lines
     SET item_revision_id = v_rev0, updated_at = now()
   WHERE id = v_jw_line AND item_id = v_item AND revision = '0' AND item_revision_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '0256: JW-8 line 2 rows %', n;

  UPDATE public.plans SET item_revision_id = v_rev0, updated_at = now()
   WHERE id = v_plan AND item_id = v_item AND item_revision_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '0256: PLN-0025 rows %', n;

  UPDATE public.production_orders
     SET item_revision_id = v_rev0, route_card_id = v_rc97,
         route_card_code_text = 'IN-RC-00097', route_card_revision = v_rc97_rev, updated_at = now()
   WHERE id = v_pro AND item_revision_id IS NULL AND status = 'open';
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '0256: PRO-58 rows %', n;
  IF n = 1 THEN
    INSERT INTO public.activity_log (company_id, user_name, action, entity, detail, ref_id, entity_id, reason)
    VALUES (v_company, 'system (data fix 0256)', 'EDIT', 'ProductionOrder',
            'Drawing Rev — → 0; Route Card IN-RC-00043 → IN-RC-00097 (Rev 0)', 'IN-PRO-00058', v_pro,
            'JW-8 line 2 is Rev 0; owner-approved data fix 17-Nov-2026');
  END IF;

  UPDATE public.job_cards
     SET item_revision_id = v_rev0, route_card_id = v_rc97, route_card_revision = v_rc97_rev, updated_at = now()
   WHERE id = v_jc AND item_revision_id IS NULL AND item_id = v_item;
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '0256: JC-26-00058 rows %', n;
  IF n = 1 THEN
    INSERT INTO public.activity_log (company_id, user_name, action, entity, detail, ref_id, entity_id, reason)
    VALUES (v_company, 'system (data fix 0256)', 'EDIT', 'JobCard',
            'Drawing Rev — → 0; Route Card IN-RC-00099 → IN-RC-00097 (Rev 0)', 'IN-JC-26-00058', v_jc,
            'JW-8 line 2 is Rev 0; owner-approved data fix 17-Nov-2026');
  END IF;
END $$;
