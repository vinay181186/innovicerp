// "Ready for You" — the ONE definition of a job-card op ready to run:
// available > 0, not running, not an outsource / QC op. Read by the home's
// ops_ready list (ADR-250, personal/rows-production.ts).

// One FROM/WHERE, so the list's rows and its total can never disagree.
export const READY_FROM = (cid: string): string => `
     FROM v_jc_op_status vs
     JOIN jc_ops o ON o.id = vs.jc_op_id AND o.deleted_at IS NULL
     JOIN job_cards jc ON jc.id = o.job_card_id AND jc.deleted_at IS NULL
     LEFT JOIN machines m ON m.id = o.machine_id
     LEFT JOIN sales_order_lines sol ON sol.id = jc.source_so_line_id
     LEFT JOIN job_work_order_lines rev_jwl ON rev_jwl.id = jc.source_jw_line_id AND rev_jwl.deleted_at IS NULL
     WHERE vs.company_id='${cid}'::uuid AND vs.available > 0
       AND vs.computed_status IN ('available','in_progress')
       AND vs.op_type NOT IN ('outsource','qc')`;
