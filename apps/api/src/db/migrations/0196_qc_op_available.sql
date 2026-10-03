-- ============================================================
-- 0196_qc_op_available.sql
-- Job Card "Op Qty Flow" (and every reader of v_jc_op_status.available):
-- a QC op's Available fell into the plain-op branch, which subtracts only
-- 'complete' op_log rows — a QC op never has any — so Available stayed equal
-- to Input (= Passed On once everything passed). QC ops now subtract their QC
-- accepted + rejected, the same rule as pending_qty. Process and outsource ops
-- are unchanged. Same columns, order and types: CREATE OR REPLACE keeps the
-- dependent views (v_jc_status, v_osp_wip) and grants. Body = live
-- pg_get_viewdef (identical on PROD and TEST, 2026-10-03) + this one CASE.
-- Idempotent. Apply to BOTH databases. Rollback: re-run 0176's definition.
-- ============================================================

CREATE OR REPLACE VIEW public.v_jc_op_status AS
 WITH op_log_rollup AS (
         SELECT op_log.jc_op_id,
            sum(
                CASE
                    WHEN op_log.log_type = 'complete'::op_log_type THEN op_log.qty
                    ELSE 0
                END) AS completed_qty,
            sum(
                CASE
                    WHEN op_log.log_type = 'qc'::op_log_type THEN op_log.qty
                    ELSE 0
                END) AS qc_accepted_qty,
            sum(
                CASE
                    WHEN op_log.log_type = 'qc'::op_log_type THEN op_log.reject_qty
                    ELSE 0
                END) AS qc_rejected_qty,
            GREATEST(0::bigint, sum(
                CASE
                    WHEN op_log.log_type = 'complete'::op_log_type THEN op_log.reject_qty
                    ELSE 0
                END) - sum(
                CASE
                    WHEN op_log.log_type = 'complete'::op_log_type AND op_log.log_no ~~ 'LOG-NC-%'::text THEN op_log.qty
                    ELSE 0
                END)) AS production_rejected_open_qty,
            sum(
                CASE
                    WHEN op_log.log_type = 'complete'::op_log_type THEN op_log.reject_qty
                    ELSE 0
                END) AS production_rejected_qty
           FROM op_log
          GROUP BY op_log.jc_op_id
        ), running_check AS (
         SELECT DISTINCT running_ops.jc_op_id
           FROM running_ops
          WHERE running_ops.status = 'running'::running_op_status
        ), op_po_lines AS (
         SELECT o_1.id AS jc_op_id,
            o_1.outsource_po_line_id AS purchase_order_line_id
           FROM jc_ops o_1
          WHERE o_1.deleted_at IS NULL AND o_1.outsource_po_line_id IS NOT NULL
        UNION
         SELECT l.jc_op_id,
            l.purchase_order_line_id
           FROM jc_op_po_lines l
          WHERE l.deleted_at IS NULL
        ), outsource_receipts_rollup AS (
         SELECT o_1.id AS jc_op_id,
            COALESCE(sum(grl.received_qty), 0::numeric) AS osp_received_qty,
            COALESCE(sum(grl.received_qty) FILTER (WHERE grn.nc_id IS NULL), 0::numeric) AS osp_ordinary_received_qty,
            COALESCE(sum(grl.qc_accepted_qty), 0::numeric) AS osp_accepted_qty,
            COALESCE(sum(grl.qc_rejected_qty), 0::numeric) AS osp_rejected_qty
           FROM jc_ops o_1
             LEFT JOIN op_po_lines opl ON opl.jc_op_id = o_1.id
             LEFT JOIN goods_receipt_note_lines grl ON grl.purchase_order_line_id = opl.purchase_order_line_id AND grl.deleted_at IS NULL
             LEFT JOIN goods_receipt_notes grn ON grn.id = grl.goods_receipt_note_id AND grn.deleted_at IS NULL
          WHERE o_1.deleted_at IS NULL
          GROUP BY o_1.id
        ), rework_outstanding AS (
         SELECT nc.job_card_id,
            nc.rework_op_seq,
            GREATEST(0::numeric, sum(nc.rejected_qty - COALESCE(nc.rework_done_qty, 0::numeric))) AS qty
           FROM nc_register nc
          WHERE nc.disposition = 'rework'::nc_disposition AND nc.status <> 'closed'::nc_status AND nc.rework_op_seq IS NOT NULL AND nc.deleted_at IS NULL
          GROUP BY nc.job_card_id, nc.rework_op_seq
        ), rework_raised AS (
         SELECT nc.job_card_id,
            nc.op_seq,
            GREATEST(0::numeric, sum(nc.rejected_qty - COALESCE(nc.rework_done_qty, 0::numeric))) AS qty,
            string_agg(DISTINCT nc.rework_op_seq::text, ', '::text) AS to_ops
           FROM nc_register nc
          WHERE nc.disposition = 'rework'::nc_disposition AND nc.status <> 'closed'::nc_status AND nc.op_seq IS NOT NULL AND nc.rework_op_seq IS NOT NULL AND nc.deleted_at IS NULL
          GROUP BY nc.job_card_id, nc.op_seq
        ), rework_child_open AS (
         SELECT nc.job_card_id,
            nc.op_seq,
            GREATEST(0::numeric, sum(nc.rejected_qty - nc.cleared_qty - nc.failed_qty)) AS qty
           FROM nc_register nc
          WHERE (nc.disposition = ANY (ARRAY['rework'::nc_disposition, 'repair'::nc_disposition])) AND nc.status <> 'closed'::nc_status AND nc.child_job_card_id IS NOT NULL AND nc.op_seq IS NOT NULL AND nc.deleted_at IS NULL
          GROUP BY nc.job_card_id, nc.op_seq
        ), returned_to_vendor AS (
         SELECT nc.jc_op_id,
            GREATEST(0::numeric, COALESCE(sum(nc.rtv_sent_qty - nc.rtv_received_qty) FILTER (WHERE nc.delivery_challan_id IS NOT NULL), 0::numeric)) AS at_vendor_qty,
            GREATEST(0::numeric, sum(nc.rejected_qty - nc.cleared_qty - nc.failed_qty)) AS open_qty
           FROM nc_register nc
             JOIN jc_ops o_1 ON o_1.id = nc.jc_op_id AND o_1.deleted_at IS NULL AND (o_1.op_type = 'outsource'::op_type OR o_1.outsource_po_line_id IS NOT NULL)
          WHERE nc.disposition = 'return_to_vendor'::nc_disposition AND nc.status <> 'closed'::nc_status AND nc.jc_op_id IS NOT NULL AND nc.deleted_at IS NULL
          GROUP BY nc.jc_op_id
        ), op_loss AS (
         SELECT x.jc_op_id,
            sum(x.amt) AS loss_qty,
            COALESCE(sum(x.amt) FILTER (WHERE x.off_output), 0::numeric) AS loss_off_output_qty
           FROM ( SELECT nc.jc_op_id,
                        CASE
                            WHEN nc.status = 'closed'::nc_status AND (nc.disposition = ANY (ARRAY['scrap'::nc_disposition, 'make_fresh'::nc_disposition])) THEN nc.rejected_qty
                            WHEN nc.disposition = ANY (ARRAY['rework'::nc_disposition, 'repair'::nc_disposition]) THEN nc.failed_qty
                            ELSE 0::numeric
                        END AS amt,
                    nc.grn_line_id IS NOT NULL OR COALESCE(src.log_type = 'complete'::op_log_type, false) AS off_output
                   FROM nc_register nc
                     LEFT JOIN op_log src ON src.id = nc.qc_log_id
                  WHERE nc.deleted_at IS NULL AND nc.jc_op_id IS NOT NULL) x
          GROUP BY x.jc_op_id
        ), prev_op_output AS (
         SELECT o_1.id AS jc_op_id,
            o_1.job_card_id,
            o_1.op_seq,
            jc.order_qty AS jc_order_qty,
            lag(
                CASE
                    WHEN o_1.qc_required OR o_1.op_type = 'qc'::op_type THEN COALESCE(r_1.qc_accepted_qty, 0::bigint)::numeric
                    WHEN o_1.op_type = 'outsource'::op_type THEN COALESCE(orr_1.osp_accepted_qty, 0::numeric) + COALESCE(r_1.qc_accepted_qty, 0::bigint)::numeric
                    ELSE COALESCE(r_1.completed_qty, 0::bigint)::numeric + COALESCE(orr_1.osp_accepted_qty, 0::numeric)
                END, 1) OVER (PARTITION BY o_1.job_card_id ORDER BY o_1.op_seq) AS prev_output,
            COALESCE(sum(
                CASE
                    WHEN o_1.qc_required OR (o_1.op_type = ANY (ARRAY['qc'::op_type, 'outsource'::op_type])) THEN COALESCE(ol_1.loss_qty, 0::numeric)
                    ELSE COALESCE(ol_1.loss_off_output_qty, 0::numeric)
                END) OVER (PARTITION BY o_1.job_card_id ORDER BY o_1.op_seq ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0::numeric) AS upstream_loss
           FROM jc_ops o_1
             LEFT JOIN op_log_rollup r_1 ON r_1.jc_op_id = o_1.id
             LEFT JOIN outsource_receipts_rollup orr_1 ON orr_1.jc_op_id = o_1.id
             LEFT JOIN op_loss ol_1 ON ol_1.jc_op_id = o_1.id
             LEFT JOIN job_cards jc ON jc.id = o_1.job_card_id
          WHERE o_1.deleted_at IS NULL AND jc.deleted_at IS NULL
        )
 SELECT o.id AS jc_op_id,
    o.company_id,
    o.job_card_id,
    o.op_seq,
    o.op_type,
    o.qc_required,
    o.outsource_status,
    (COALESCE(r.completed_qty, 0::bigint)::numeric + COALESCE(orr.osp_accepted_qty, 0::numeric) +
        CASE
            WHEN o.op_type = 'outsource'::op_type THEN COALESCE(r.qc_accepted_qty, 0::bigint)
            ELSE 0::bigint
        END::numeric)::integer AS completed_qty,
    COALESCE(r.qc_accepted_qty, 0::bigint)::integer AS qc_accepted_qty,
    COALESCE(r.qc_rejected_qty, 0::bigint)::integer AS qc_rejected_qty,
        CASE
            WHEN o.op_seq = 1 THEN p.jc_order_qty::numeric
            ELSE COALESCE(p.prev_output, 0::numeric)
        END::integer AS input_avail,
        CASE
            -- 0196: a QC op is worked off by its QC entries (accepted + rejected),
            -- never by 'complete' rows — same rule as pending_qty's QC branch.
            WHEN o.op_type = 'qc'::op_type THEN GREATEST(0::numeric,
            CASE
                WHEN o.op_seq = 1 THEN p.jc_order_qty::numeric
                ELSE COALESCE(p.prev_output, 0::numeric)
            END - COALESCE(r.qc_accepted_qty, 0::bigint)::numeric - COALESCE(r.qc_rejected_qty, 0::bigint)::numeric)
            ELSE GREATEST(0::numeric,
        CASE
            WHEN o.op_seq = 1 THEN p.jc_order_qty::numeric
            ELSE COALESCE(p.prev_output, 0::numeric)
        END -
        CASE
            WHEN o.op_type = 'outsource'::op_type THEN COALESCE(orr.osp_accepted_qty, 0::numeric) + COALESCE(r.qc_accepted_qty, 0::bigint)::numeric
            ELSE (COALESCE(r.completed_qty, 0::bigint) + COALESCE(o.outsource_sent_qty, 0) + COALESCE(r.production_rejected_open_qty, 0::bigint))::numeric
        END - COALESCE(rtv.open_qty, 0::numeric)) + COALESCE(rw.qty, 0::numeric)
        END AS available,
        CASE
            WHEN o.qc_required OR o.op_type = 'qc'::op_type THEN GREATEST(0::numeric,
            CASE
                WHEN o.op_type = 'qc'::op_type THEN
                CASE
                    WHEN o.op_seq = 1 THEN p.jc_order_qty::numeric
                    ELSE COALESCE(p.prev_output, 0::numeric)
                END
                ELSE COALESCE(r.completed_qty, 0::bigint)::numeric + COALESCE(orr.osp_accepted_qty, 0::numeric)
            END - COALESCE(r.qc_accepted_qty, 0::bigint)::numeric - COALESCE(r.qc_rejected_qty, 0::bigint)::numeric)
            ELSE 0::numeric
        END AS qc_pending,
        CASE
            WHEN COALESCE(rw.qty, 0::numeric) = 0::numeric AND COALESCE(rtv.open_qty, 0::numeric) = 0::numeric AND COALESCE(rwc.qty, 0::numeric) = 0::numeric AND p.jc_order_qty > 0 AND (
            CASE
                WHEN o.op_type = 'qc'::op_type THEN
                CASE
                    WHEN o.op_seq = 1 THEN p.jc_order_qty::numeric
                    ELSE COALESCE(p.prev_output, 0::numeric)
                END
                ELSE COALESCE(r.completed_qty, 0::bigint)::numeric + COALESCE(orr.osp_accepted_qty, 0::numeric) + COALESCE(ol.loss_off_output_qty, 0::numeric)
            END + COALESCE(p.upstream_loss, 0::numeric)) >= p.jc_order_qty::numeric AND (NOT (o.qc_required OR o.op_type = 'qc'::op_type) OR (COALESCE(r.qc_accepted_qty, 0::bigint)::numeric +
            CASE
                WHEN o.op_type = 'qc'::op_type THEN COALESCE(ol.loss_qty, 0::numeric)
                ELSE COALESCE(ol.loss_qty, 0::numeric) - COALESCE(ol.loss_off_output_qty, 0::numeric)
            END) >=
            CASE
                WHEN o.op_type = 'qc'::op_type THEN
                CASE
                    WHEN o.op_seq = 1 THEN p.jc_order_qty::numeric
                    ELSE COALESCE(p.prev_output, 0::numeric)
                END
                ELSE COALESCE(r.completed_qty, 0::bigint)::numeric + COALESCE(orr.osp_accepted_qty, 0::numeric)
            END) THEN 'complete'::text
            WHEN COALESCE(rw.qty, 0::numeric) = 0::numeric AND COALESCE(rtv.open_qty, 0::numeric) = 0::numeric AND COALESCE(rwc.qty, 0::numeric) = 0::numeric AND o.op_type = 'outsource'::op_type AND
            CASE
                WHEN o.op_seq = 1 THEN p.jc_order_qty::numeric
                ELSE COALESCE(p.prev_output, 0::numeric)
            END > 0::numeric AND (COALESCE(orr.osp_accepted_qty, 0::numeric) + COALESCE(r.qc_accepted_qty, 0::bigint)::numeric + COALESCE(ol.loss_qty, 0::numeric)) >=
            CASE
                WHEN o.op_seq = 1 THEN p.jc_order_qty::numeric
                ELSE COALESCE(p.prev_output, 0::numeric)
            END THEN 'complete'::text
            WHEN (o.qc_required OR o.op_type = 'qc'::op_type) AND GREATEST(0::numeric,
            CASE
                WHEN o.op_type = 'qc'::op_type THEN
                CASE
                    WHEN o.op_seq = 1 THEN p.jc_order_qty::numeric
                    ELSE COALESCE(p.prev_output, 0::numeric)
                END
                ELSE COALESCE(r.completed_qty, 0::bigint)::numeric + COALESCE(orr.osp_accepted_qty, 0::numeric)
            END - COALESCE(r.qc_accepted_qty, 0::bigint)::numeric - COALESCE(r.qc_rejected_qty, 0::bigint)::numeric) > 0::numeric THEN 'qc_pending'::text
            WHEN rc.jc_op_id IS NOT NULL THEN 'running'::text
            WHEN COALESCE(r.completed_qty, 0::bigint) > 0 OR COALESCE(r.production_rejected_qty, 0::bigint) > 0 OR (COALESCE(r.qc_accepted_qty, 0::bigint) + COALESCE(r.qc_rejected_qty, 0::bigint)) > 0 OR COALESCE(orr.osp_accepted_qty, 0::numeric) > 0::numeric THEN 'in_progress'::text
            WHEN o.op_type = 'outsource'::op_type AND (COALESCE(orr.osp_received_qty, 0::numeric) - COALESCE(orr.osp_accepted_qty, 0::numeric) - COALESCE(orr.osp_rejected_qty, 0::numeric)) > 0::numeric THEN 'received'::text
            WHEN o.op_type = 'outsource'::op_type THEN
            CASE COALESCE(o.outsource_status::text, 'pending'::text)
                WHEN 'pr_raised'::text THEN 'pr_raised'::text
                WHEN 'po_created'::text THEN 'po_created'::text
                WHEN 'sent'::text THEN 'at_vendor'::text
                WHEN 'received'::text THEN 'received'::text
                ELSE
                CASE
                    WHEN
                    CASE
                        WHEN o.op_seq = 1 THEN p.jc_order_qty::numeric
                        ELSE COALESCE(p.prev_output, 0::numeric)
                    END > 0::numeric THEN 'ready_for_pr'::text
                    ELSE 'outsource'::text
                END
            END
            WHEN
            CASE
                WHEN o.op_seq = 1 THEN p.jc_order_qty::numeric
                ELSE COALESCE(p.prev_output, 0::numeric)
            END > 0::numeric THEN 'available'::text
            ELSE 'waiting'::text
        END AS computed_status,
    (GREATEST(0::numeric, COALESCE(o.outsource_sent_qty, 0)::numeric - COALESCE(orr.osp_ordinary_received_qty, 0::numeric)) + COALESCE(rtv.at_vendor_qty, 0::numeric))::integer AS at_vendor_qty,
    GREATEST(0::numeric, COALESCE(orr.osp_received_qty, 0::numeric) - COALESCE(orr.osp_accepted_qty, 0::numeric) - COALESCE(orr.osp_rejected_qty, 0::numeric))::integer AS in_qc_qty,
        CASE
            WHEN o.op_type = 'qc'::op_type THEN GREATEST(0::numeric,
            CASE
                WHEN o.op_seq = 1 THEN p.jc_order_qty::numeric
                ELSE COALESCE(p.prev_output, 0::numeric)
            END - COALESCE(r.qc_accepted_qty, 0::bigint)::numeric - COALESCE(r.qc_rejected_qty, 0::bigint)::numeric)
            ELSE GREATEST(0::numeric,
            CASE
                WHEN o.op_seq = 1 THEN p.jc_order_qty::numeric
                ELSE COALESCE(p.prev_output, 0::numeric)
            END -
            CASE
                WHEN o.op_type = 'outsource'::op_type THEN COALESCE(orr.osp_accepted_qty, 0::numeric) + COALESCE(r.qc_accepted_qty, 0::bigint)::numeric
                ELSE (COALESCE(r.completed_qty, 0::bigint) + COALESCE(o.outsource_sent_qty, 0) + COALESCE(r.production_rejected_open_qty, 0::bigint))::numeric
            END - COALESCE(rtv.open_qty, 0::numeric)) + COALESCE(rw.qty, 0::numeric)
        END::integer AS pending_qty,
    COALESCE(rw.qty, 0::numeric)::integer AS rework_pending_qty,
    COALESCE(rr.qty, 0::numeric)::integer AS rework_raised_qty,
    rr.to_ops AS rework_raised_to_ops,
    COALESCE(rtv.open_qty, 0::numeric)::integer AS returned_to_vendor_qty
   FROM jc_ops o
     LEFT JOIN op_log_rollup r ON r.jc_op_id = o.id
     LEFT JOIN running_check rc ON rc.jc_op_id = o.id
     LEFT JOIN outsource_receipts_rollup orr ON orr.jc_op_id = o.id
     LEFT JOIN prev_op_output p ON p.jc_op_id = o.id
     LEFT JOIN rework_outstanding rw ON rw.job_card_id = o.job_card_id AND rw.rework_op_seq = o.op_seq
     LEFT JOIN rework_raised rr ON rr.job_card_id = o.job_card_id AND rr.op_seq = o.op_seq
     LEFT JOIN rework_child_open rwc ON rwc.job_card_id = o.job_card_id AND rwc.op_seq = o.op_seq
     LEFT JOIN returned_to_vendor rtv ON rtv.jc_op_id = o.id
     LEFT JOIN op_loss ol ON ol.jc_op_id = o.id
  WHERE o.deleted_at IS NULL;
