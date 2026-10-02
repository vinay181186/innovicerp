// Job Queue service (Production slice F).
//
// Pending ops per machine, manually reorderable. Mirrors legacy renderJobQueue
// (HTML L10363) + applyQueueOrder + moveInQueue.
//
// The queue itself is read in queue-load.ts. Paged mode + the server ▲/▼ move
// are ADR-201 (25 rows per page).

import { sql } from 'drizzle-orm';
import type {
  JobQueueQuery,
  JobQueueResponse,
  JobQueueRow,
  MoveJobQueueOpInput,
  ReorderJobQueueInput,
} from '@innovic/shared';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { requireAdminRole } from '../../lib/auth';
import { AuthorizationError, ConflictError, NotFoundError } from '../../lib/errors';
import { loadMachineQueues } from './queue-load';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

/** What the search box matches — the columns the row shows, CODE/REV as printed. */
function rowMatches(r: JobQueueRow, term: string): boolean {
  const code = r.itemCode?.trim();
  const rev = r.itemRevision?.trim();
  const codeRev = code ? (rev ? `${code}/${rev}` : code) : null;
  return [
    r.jcCode,
    r.clientPoLineNo,
    codeRev,
    r.itemName,
    r.soCode,
    r.soCustomer,
    r.operation,
  ].some((v) => v != null && v.toLowerCase().includes(term));
}

export async function getJobQueue(
  input: JobQueueQuery,
  user: AuthContext,
): Promise<JobQueueResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    if (input.limit == null) {
      return { machines: await loadMachineQueues(tx, companyId, input.machineId) };
    }
    // Paged mode (ADR-201). The queue is resolved per machine in JS (text-only
    // machine codes, QC skip), so the page is cut from that one ordered list:
    // machines by code, each in its saved queue order. Machine summaries stay
    // whole-queue figures; only the page's rows travel to the browser.
    const all = await loadMachineQueues(tx, companyId);
    const term = (input.search ?? '').trim().toLowerCase();
    const flat: Array<{ machineId: string; row: JobQueueRow }> = [];
    for (const m of all) {
      if (input.machineId && m.machineId !== input.machineId) continue;
      m.rows.forEach((row, i) => {
        if (term === '' || rowMatches(row, term)) {
          flat.push({ machineId: m.machineId, row: { ...row, queueIndex: i } });
        }
      });
    }
    const offset = input.offset ?? 0;
    const page = flat.slice(offset, offset + input.limit);
    const machines = all.map((m) => ({
      ...m,
      rows: page.filter((p) => p.machineId === m.machineId).map((p) => p.row),
    }));
    return { machines, total: flat.length };
  });
}

/**
 * ▲/▼ on one row (ADR-201): swap it with its neighbour in the machine's FULL
 * queue and renumber that queue 1..N — the same result the old full-list PUT
 * gave, but the browser no longer needs the whole queue (it holds one page).
 */
export async function moveQueueOp(
  machineId: string,
  input: MoveJobQueueOpInput,
  user: AuthContext,
): Promise<{ ok: true }> {
  await requireFormAccess(user, 'jc_create', 'edit');
  const companyId = requireCompany(user);
  const userId = user.id;
  return withUserContext(user, async (tx) => {
    const [machine] = await loadMachineQueues(tx, companyId, machineId);
    if (!machine) throw new NotFoundError(`Machine ${machineId} not found`);
    const ids = machine.rows.map((r) => r.jcOpId);
    const idx = ids.indexOf(input.jcOpId);
    if (idx === -1) {
      throw new ConflictError('The queue changed on another screen. Refresh and try again.');
    }
    const swap = input.dir === 'up' ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= ids.length) return { ok: true };
    ids[idx] = ids[swap]!;
    ids[swap] = input.jcOpId;
    for (let i = 0; i < ids.length; i++) {
      await tx.execute(sql`
        UPDATE public.jc_ops
        SET queue_position = ${i + 1},
            updated_at = now(),
            updated_by = ${userId}::uuid
        WHERE id = ${ids[i]!}::uuid
          AND company_id = ${companyId}::uuid
          AND queue_position IS DISTINCT FROM ${i + 1}
      `);
    }
    return { ok: true };
  });
}

export async function reorderMachineQueue(
  machineId: string,
  input: ReorderJobQueueInput,
  user: AuthContext,
): Promise<{ ok: true }> {
  // Reordering the queue rewrites saved jc_ops (queue_position) — an edit on the
  // Job Card (jc_create). Previously this write had NO matrix guard at all.
  await requireFormAccess(user, 'jc_create', 'edit');
  const companyId = requireCompany(user);
  const userId = user.id;
  return withUserContext(user, async (tx) => {
    // Verify machine exists in this company
    const machineRows = (await tx.execute(sql`
      SELECT id, code FROM public.machines
      WHERE id = ${machineId}::uuid
        AND company_id = ${companyId}::uuid
        AND deleted_at IS NULL
      LIMIT 1
    `)) as unknown as Array<{ id: string; code: string | null }>;
    if (!machineRows[0]) throw new NotFoundError(`Machine ${machineId} not found`);
    // Ops may belong to this machine by FK or by machine_code_text (ADR-012 #10);
    // match both so text-only-machine ops surfaced by the queue can be reordered.
    const machineCode = machineRows[0].code ?? '';

    // Verify all op ids belong to this machine + company
    const placeholders = input.jcOpIds.map(() => sql`?::uuid`);
    const idArr = sql`ARRAY[${sql.join(
      input.jcOpIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )}]`;
    void placeholders;
    const opRows = (await tx.execute(sql`
      SELECT id
      FROM public.jc_ops
      WHERE id = ANY(${idArr})
        AND company_id = ${companyId}::uuid
        AND (machine_id = ${machineId}::uuid OR machine_code_text = ${machineCode})
        AND deleted_at IS NULL
    `)) as unknown as Array<{ id: string }>;
    if (opRows.length !== input.jcOpIds.length) {
      throw new ConflictError('The queue changed on another screen. Refresh and try again.');
    }

    // Assign queue_position 1..N
    for (let i = 0; i < input.jcOpIds.length; i++) {
      const opId = input.jcOpIds[i]!;
      const pos = i + 1;
      await tx.execute(sql`
        UPDATE public.jc_ops
        SET queue_position = ${pos},
            updated_at = now(),
            updated_by = ${userId}::uuid
        WHERE id = ${opId}::uuid
          AND company_id = ${companyId}::uuid
      `);
    }

    return { ok: true };
  });
}

/**
 * One-time data hygiene: populate jc_ops.machine_id from machine_code_text where
 * the FK is null but the text matches a machine code (the ADR-012 #10 fallback
 * left by plan/route-sourced ops). Idempotent — only fills nulls with an exact
 * company + code match, so it is safe to run repeatedly. Admin-only.
 * Returns how many ops were linked. The queue already resolves these at read
 * time; this just makes the FK first-class.
 */
export async function backfillJcOpMachineIds(user: AuthContext): Promise<{ updated: number }> {
  requireAdminRole(user);
  const companyId = requireCompany(user);
  const userId = user.id;
  return withUserContext(user, async (tx) => {
    const updated = (await tx.execute(sql`
      UPDATE public.jc_ops AS op
      SET machine_id = m.id,
          updated_at = now(),
          updated_by = ${userId}::uuid
      FROM public.machines AS m
      WHERE op.company_id = ${companyId}::uuid
        AND op.machine_id IS NULL
        AND op.machine_code_text IS NOT NULL
        AND op.deleted_at IS NULL
        AND m.company_id = op.company_id
        AND m.deleted_at IS NULL
        AND m.code = op.machine_code_text
      RETURNING op.id
    `)) as unknown as Array<{ id: string }>;
    return { updated: updated.length };
  });
}
