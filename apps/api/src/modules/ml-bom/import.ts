// Multi-Level BOM Excel import (ADR-225 phase 2) — POST /ml-boms/import.
//
//   import-rows.ts      per-row checks + master lookups
//   import-graph.ts     loop / depth across the file and the live BOMs
//   import-tree.ts      the Preview tree
//   import-validate.ts  THE rule set (validateImport), used for both modes
//   import.ts           access, the transaction, the save
//
// Preview (dryRun: true) and Import (dryRun: false) run the SAME
// validateImport. The import is ONE transaction for the whole file: the
// per-company tree lock first, then validateImport again (the Preview may be
// stale), then every BOM bottom-up, then the loop / depth guard on everything
// touched, then one History row per BOM. Any refusal rolls the whole file
// back — all or nothing. A double-click is the Idempotency-Key plugin's job.

import { ActivityAction, type MlBomImportInput, type MlBomImportResult } from '@innovic/shared';
import { requireFormAccess } from '../../lib/access';
import { requireWriteRole } from '../../lib/auth';
import { AuthorizationError } from '../../lib/errors';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { emitActivityLog } from '../activity-log/service';
import { lockMlBomTree } from './guards';
import { requireCompany } from './helpers';
import { type BomPlan, type ImportValidation, validateImport } from './import-validate';
import {
  ENTITY,
  type RevisedMlBom,
  emitReviseAudit,
  guardAll,
  insertMlBomCore,
  reviseMlBomCore,
} from './writes';

const FORM = 'mlbom_create';

/** Preview needs View + Entry; an import that revises a live BOM also Edit. */
export async function importMlBoms(
  input: MlBomImportInput,
  user: AuthContext,
): Promise<MlBomImportResult> {
  requireWriteRole(user);
  await requireFormAccess(user, FORM, 'view');
  await requireFormAccess(user, FORM, 'entry');
  const companyId = requireCompany(user);
  return withUserContext(user, (tx) => runImportTx(tx, companyId, input, user));
}

export async function runImportTx(
  tx: DbTransaction,
  companyId: string,
  input: MlBomImportInput,
  user: AuthContext,
): Promise<MlBomImportResult> {
  // FIRST: no other link-changing Multi-Level BOM write of this company can
  // run between the check below and the writes after it (CLAUDE.md §20.3).
  if (!input.dryRun) await lockMlBomTree(tx, companyId);

  // The same rule set for both modes; on a real import it re-runs here,
  // inside the transaction and under the lock.
  const v = await validateImport(tx, companyId, input);

  // Revising a live BOM needs Edit. Checked in BOTH modes and reported as a
  // file error, so the Preview tells the truth and the Import refuses the
  // same way (saved: false, nothing written).
  const revised = v.result.boms.filter((b) => b.action === 'revise');
  if (revised.length > 0 && !(await hasEditRight(user))) {
    for (const b of revised) {
      v.result.fileErrors.push(`Revising ${b.code} needs Edit rights on Multi-Level BOM`);
    }
    v.result.ok = false;
  }

  if (input.dryRun || !v.result.ok) return v.result;
  return saveImport(tx, companyId, input, user, v);
}

async function hasEditRight(user: AuthContext): Promise<boolean> {
  try {
    await requireFormAccess(user, FORM, 'edit');
    return true;
  } catch (e) {
    if (e instanceof AuthorizationError) return false;
    throw e;
  }
}

/** Children before parents (the file's Manufacture links), so each parent's
 *  link resolution finds its child's Default already written. */
function bottomUp(plans: readonly BomPlan[]): BomPlan[] {
  const byItem = new Map(plans.map((p) => [p.item.id, p]));
  const done = new Set<string>();
  const order: BomPlan[] = [];
  const visit = (p: BomPlan): void => {
    if (done.has(p.item.id)) return;
    done.add(p.item.id);
    for (const l of p.lines) {
      const child = l.bomType === 'manufacture' ? byItem.get(l.childItemId) : undefined;
      if (child) visit(child);
    }
    order.push(p);
  };
  for (const p of plans) visit(p);
  return order;
}

interface SavedBom {
  id: string;
  code: string;
  revision: number;
  /** Set on a revise: what the edit wrote, for its History rows. */
  revised: RevisedMlBom | null;
}

async function saveImport(
  tx: DbTransaction,
  companyId: string,
  input: MlBomImportInput,
  user: AuthContext,
  v: ImportValidation,
): Promise<MlBomImportResult> {
  const note = `Imported from ${input.fileName}`;
  const saved = new Map<string, SavedBom>();
  const touched: string[] = [];

  for (const p of bottomUp(v.plans)) {
    if (p.existing) {
      // Decision 7: a new revision of the item's Default, under its row lock,
      // refused (409) if it changed after the check above read it.
      const r = await reviseMlBomCore(
        tx,
        companyId,
        p.existing.id,
        {
          itemId: p.item.id,
          lines: p.lines,
          revisionNote: note,
          expectedUpdatedAt: p.existing.updatedAt,
        },
        user,
      );
      touched.push(r.header.id);
      saved.set(p.item.id, {
        id: r.header.id,
        code: r.header.code,
        revision: r.newRevision,
        revised: r,
      });
    } else {
      // Same rule as create: Default when the item has none (it has none —
      // else this would be a revise).
      const r = await insertMlBomCore(
        tx,
        companyId,
        { itemId: p.item.id, lines: p.lines },
        user,
        note,
      );
      touched.push(r.header.id, ...r.relinked);
      saved.set(p.item.id, {
        id: r.header.id,
        code: r.header.code,
        revision: 1,
        revised: null,
      });
    }
  }

  // After ALL writes: no loop, nothing deeper than the cap — else 409 and
  // the whole file rolls back.
  await guardAll(tx, companyId, touched);

  // History (ADR-197): a revise writes exactly the rows a screen edit
  // writes — header (BOM Rev) plus one before → after row per changed line —
  // with the file named; a create writes its CREATE row.
  for (const p of v.plans) {
    const s = saved.get(p.item.id)!;
    if (s.revised) {
      await emitReviseAudit(tx, companyId, user, s.revised, `${s.code} — ${note}`);
      continue;
    }
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Create,
        entity: ENTITY,
        entityId: s.id,
        refId: s.code,
        detail: `${s.code} — ${note}`,
      },
      companyId,
      user,
    );
  }

  return {
    ...v.result,
    saved: true,
    boms: v.result.boms.map((b, i) => {
      const s = saved.get(v.plans[i]!.item.id);
      return s ? { ...b, code: s.code, revision: s.revision } : b;
    }),
  };
}
