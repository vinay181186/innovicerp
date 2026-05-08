// AL-013 — Machines idle (production). Legacy line 22281-22282.
// Logic: machines whose status is 'Running' (operator marked them as
// running) but no running_ops row currently has status='running' against
// them — i.e. operator forgot to start the op or stopped without
// resetting machine status.
//
// Mirror of legacy `m.status==='Running'&&!runJcOps[m.machineId]`.
// machine.status is text not enum; values seen in legacy data:
// 'Running', 'Idle', 'Down'. We don't normalise (legacy left it free-
// form); match the literal 'Running' for parity.

import { sql } from 'drizzle-orm';
import type { RegisteredAlert } from '../registry';

export const al013MachinesIdle: RegisteredAlert = {
  definition: {
    code: 'AL-013',
    dept: 'production',
    name: 'Machines idle',
    description:
      'Machines whose status is "Running" but have no actively-running op against them — likely a forgotten stop.',
    columns: [
      { key: 'machine_code', label: 'Machine code', type: 'text' },
      { key: 'machine_name', label: 'Name', type: 'text' },
      { key: 'machine_type', label: 'Type', type: 'text' },
      { key: 'status', label: 'Status', type: 'text' },
    ],
    defaultActive: true,
  },
  async run({ tx, companyId }) {
    const result = await tx.execute(sql`
      SELECT m.code AS machine_code, m.name AS machine_name,
             COALESCE(m.machine_type, '') AS machine_type, m.status
      FROM public.machines m
      WHERE m.company_id = ${companyId}::uuid
        AND m.deleted_at IS NULL
        AND m.status = 'Running'
        AND NOT EXISTS (
          SELECT 1 FROM public.running_ops r
          WHERE r.machine_id = m.id AND r.status = 'running'
        )
      ORDER BY m.code
    `);
    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      machine_code: (r['machine_code'] as string) ?? '',
      machine_name: (r['machine_name'] as string) ?? '',
      machine_type: (r['machine_type'] as string) ?? '',
      status: (r['status'] as string) ?? '',
    }));
    return { records: rows };
  },
};
