-- 0126 — backfill nc_register.operator_text on existing auto-created NCs.
--
-- autoCreateNcFromQcReject never set operator_text (it set reportedByText, the
-- QC inspector), so every NC raised automatically from a QC reject shows a
-- blank Operator on the NC detail page. The forward fix (op-entry/service.ts +
-- nc-register/cascades.ts) now resolves and stores the producing operator from
-- the producing op's op_log; this backfills the rows already created.
--
-- Resolution mirrors the machine/operator resolution in submitQcLog: the
-- producing op is the NC's op itself when that op is not a QC op, else the
-- latest non-QC op before it on the same JC; the operator is the operator_name
-- on that op's most recent op_log that carries one.
--
-- Idempotent: fills only rows where operator_text IS NULL and a name resolves.
-- Re-running updates nothing. Apply to BOTH the production and test databases.

UPDATE public.nc_register n
SET operator_text = sub.op_name,
    updated_at = now()
FROM (
  SELECT
    n2.id,
    (
      SELECT l.operator_name
      FROM public.op_log l
      WHERE l.jc_op_id = (
              CASE
                WHEN o.op_type = 'qc' THEN (
                  SELECT p.id
                  FROM public.jc_ops p
                  WHERE p.job_card_id = o.job_card_id
                    AND p.deleted_at IS NULL
                    AND p.op_type <> 'qc'
                    AND p.op_seq < o.op_seq
                  ORDER BY p.op_seq DESC
                  LIMIT 1
                )
                ELSE o.id
              END
            )
        AND l.operator_name IS NOT NULL
      ORDER BY l.created_at DESC
      LIMIT 1
    ) AS op_name
  FROM public.nc_register n2
  JOIN public.jc_ops o ON o.id = n2.jc_op_id
  WHERE n2.deleted_at IS NULL
    AND n2.operator_text IS NULL
    AND n2.jc_op_id IS NOT NULL
) sub
WHERE n.id = sub.id
  AND sub.op_name IS NOT NULL
  AND n.operator_text IS NULL;
