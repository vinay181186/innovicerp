// Machine utilisation — per machine over a date range: hours available
// (days × shifts × 8 h), hours actually run (Op Entry run sessions), the
// utilisation %, and the output / reject qty logged on that machine.
// Modelled on ERPNext's "Downtime Analysis" / "Workstation Utilisation" (Production Analytics) report.

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';
import { isoDateFilter, numCell, type SqlRow, textCell } from './report-helpers';

/** Assumed length of one shift, in hours. Machines carry shifts_per_day but no
 *  shift length, so Available Hours = days × shifts_per_day × this. */
const HOURS_PER_SHIFT = 8;
const HOURS_SQL = sql.raw(String(HOURS_PER_SHIFT));

export const machineUtilisationReport: RegisteredReport = {
  definition: {
    slug: 'machine-utilisation',
    title: 'Machine utilisation',
    description:
      'Per machine for the date range (last 7 days when no dates are set): Available Hours = days × Shifts/Day × 8 h (an assumed 8-hour shift), Run Hours = Op Entry run sessions on that machine clipped to the range (a session still running counts up to now), Utilisation % = Run ÷ Available. Output and Rejected are the completion entries logged on the machine in the range.',
    group: 'Production',
    dept: 'production',
    filters: [
      { key: 'fromDate', label: 'From Date', kind: 'date' },
      { key: 'toDate', label: 'To Date', kind: 'date' },
    ],
    columns: [
      { key: 'machine_code', label: 'Machine Code', type: 'text' },
      { key: 'machine_name', label: 'Machine Name', type: 'text' },
      { key: 'machine_group', label: 'Machine Group', type: 'text' },
      { key: 'shifts_per_day', label: 'Shifts/Day', type: 'number' },
      { key: 'available_hours', label: 'Available Hours', type: 'number' },
      { key: 'run_hours', label: 'Run Hours', type: 'number' },
      { key: 'utilisation_pct', label: 'Utilisation %', type: 'number' },
      { key: 'output_qty', label: 'Completed', type: 'number' },
      { key: 'reject_qty', label: 'Rejected', type: 'number' },
      { key: 'reject_pct', label: 'Reject %', type: 'number' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const fromDate = isoDateFilter(filters['fromDate']);
    const toDate = isoDateFilter(filters['toDate']);

    // Default window: the 7 days ending on the To date (or today).
    const toExpr = toDate ? sql`${toDate}::date` : sql`CURRENT_DATE`;
    const fromExpr = fromDate
      ? sql`${fromDate}::date`
      : toDate
        ? sql`(${toDate}::date - 6)`
        : sql`(CURRENT_DATE - 6)`;

    const result = await tx.execute(sql`
      WITH rng AS (
        SELECT
          ${fromExpr} AS d_from,
          ${toExpr}   AS d_to
      ),
      bounds AS (
        SELECT
          d_from,
          d_to,
          GREATEST(d_to - d_from + 1, 0)                          AS days,
          (d_from::timestamp AT TIME ZONE 'Asia/Kolkata')         AS t_from,
          ((d_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')     AS t_to
        FROM rng
      ),
      runs AS (
        -- Op Entry run sessions. start_date + start_time are shop-floor (IST)
        -- wall-clock; ended_at is a real timestamp. A session still running
        -- counts up to now; a stopped one with no end time is skipped.
        SELECT
          ro.machine_id,
          SUM(GREATEST(0, EXTRACT(EPOCH FROM (
            LEAST(s.t_end, b.t_to) - GREATEST(s.t_start, b.t_from)
          )) / 3600.0)) AS hours
        FROM public.running_ops ro
        CROSS JOIN bounds b
        CROSS JOIN LATERAL (
          SELECT
            ((ro.start_date + ro.start_time) AT TIME ZONE 'Asia/Kolkata') AS t_start,
            COALESCE(ro.ended_at, CASE WHEN ro.status = 'running' THEN now() END) AS t_end
        ) s
        WHERE ro.company_id = ${companyId}::uuid
          AND ro.is_osp = false
          AND ro.machine_id IS NOT NULL
          AND s.t_end IS NOT NULL
          AND s.t_end > b.t_from
          AND s.t_start < b.t_to
        GROUP BY ro.machine_id
      ),
      outp AS (
        SELECT
          ol.machine_id,
          SUM(ol.qty)::int        AS output_qty,
          SUM(ol.reject_qty)::int AS reject_qty
        FROM public.op_log ol
        CROSS JOIN bounds b
        WHERE ol.company_id = ${companyId}::uuid
          AND ol.log_type = 'complete'
          AND ol.machine_id IS NOT NULL
          AND ol.log_date BETWEEN b.d_from AND b.d_to
        GROUP BY ol.machine_id
      )
      SELECT
        m.code                                                    AS machine_code,
        m.name                                                    AS machine_name,
        mg.code                                                   AS machine_group,
        m.shifts_per_day                                          AS shifts_per_day,
        (b.days * m.shifts_per_day * ${HOURS_SQL})::float   AS available_hours,
        ROUND(COALESCE(r.hours, 0)::numeric, 2)::float            AS run_hours,
        CASE WHEN b.days * m.shifts_per_day > 0
             THEN ROUND((COALESCE(r.hours, 0) * 100.0
                         / (b.days * m.shifts_per_day * ${HOURS_SQL}))::numeric, 1)::float
             ELSE NULL
        END                                                       AS utilisation_pct,
        COALESCE(o.output_qty, 0)                                 AS output_qty,
        COALESCE(o.reject_qty, 0)                                 AS reject_qty,
        CASE WHEN COALESCE(o.output_qty, 0) + COALESCE(o.reject_qty, 0) > 0
             THEN ROUND(COALESCE(o.reject_qty, 0) * 100.0
                        / (COALESCE(o.output_qty, 0) + COALESCE(o.reject_qty, 0)), 1)::float
             ELSE NULL
        END                                                       AS reject_pct
      FROM public.machines m
      CROSS JOIN bounds b
      LEFT JOIN public.machine_groups mg
        ON mg.id = m.machine_group_id AND mg.deleted_at IS NULL
      LEFT JOIN runs r   ON r.machine_id = m.id
      LEFT JOIN outp o   ON o.machine_id = m.id
      WHERE m.company_id = ${companyId}::uuid
        AND m.deleted_at IS NULL
      ORDER BY m.code
      LIMIT 2000
    `);

    const rows = (result as unknown as SqlRow[]).map((r) => ({
      machine_code: String(r['machine_code'] ?? ''),
      machine_name: textCell(r['machine_name']),
      machine_group: textCell(r['machine_group']),
      shifts_per_day: numCell(r['shifts_per_day']),
      available_hours: numCell(r['available_hours']),
      run_hours: numCell(r['run_hours']),
      utilisation_pct: r['utilisation_pct'] == null ? null : numCell(r['utilisation_pct']),
      output_qty: numCell(r['output_qty']),
      reject_qty: numCell(r['reject_qty']),
      reject_pct: r['reject_pct'] == null ? null : numCell(r['reject_pct']),
    }));

    return { columns: machineUtilisationReport.definition.columns, rows };
  },
};
