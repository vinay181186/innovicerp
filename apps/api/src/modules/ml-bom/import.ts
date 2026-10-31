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
//
// Edit-approval (ADR-249 Step B2). With the gate on, a BOM the file would
// REVISE is not written: it is staged as ONE request per BOM
// (requestDocumentEditIdInTx — a savepoint inside this transaction, under the
// tree lock already held). A refusal of one BOM (an edit already waiting,
// nothing changed, …) is reported on that BOM and its rows; the rest of the
// file still saves. BOMs the file CREATES are saved directly, as before.

import { and, eq, isNull } from 'drizzle-orm';
import {
  ActivityAction,
  type MlBomImportBom,
  type MlBomImportResult,
} from '@innovic/shared';
import { primeAccess, requireFormAccess } from '../../lib/access';
import { AppError, AuthorizationError } from '../../lib/errors';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { documentEditRequests } from '../../db/schema';
import { emitActivityLog } from '../activity-log/service';
import { isDocEditApprovalOn, requestDocumentEditIdInTx } from '../document-edits/service';
import { lockMlBomTree } from './guards';
import { requireCompany } from './helpers';
import { type BomPlan, type ImportValidation, validateImport } from './import-validate';
import type { MlBomEditPayload } from './ml-bom-edit-registry';
import type { MlBomImportInputWithRev as MlBomImportInput } from './schema';
import { precheckMlBomRevise } from './service';
import {
  ENTITY,
  type RevisedMlBom,
  emitReviseAudit,
  guardAll,
  insertMlBomCore,
  reviseMlBomCore,
} from './writes';

const FORM = 'mlbom_create';

/** What happened to one BOM of a real import (shared mlBomImportBomSchema.outcome). */
export type MlBomImportOutcome = NonNullable<MlBomImportBom['outcome']>;

/** The shared result now carries the edit-approval outcome (ADR-249). */
export type MlBomImportSaveResult = MlBomImportResult;

/** Preview needs View + Entry; an import that revises a live BOM also Edit. */
export async function importMlBoms(
  input: MlBomImportInput,
  user: AuthContext,
): Promise<MlBomImportSaveResult> {
  await requireFormAccess(user, FORM, 'view');
  await requireFormAccess(user, FORM, 'entry');
  const companyId = requireCompany(user);
  // Staging checks access inside the transaction — read it once now (memo).
  await primeAccess(user);
  return withUserContext(user, (tx) => runImportTx(tx, companyId, input, user));
}

export async function runImportTx(
  tx: DbTransaction,
  companyId: string,
  input: MlBomImportInput,
  user: AuthContext,
): Promise<MlBomImportSaveResult> {
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

  // The Preview tells the truth about the approval gate too.
  const gateOn = revised.length > 0 && (await isDocEditApprovalOn(tx, companyId));
  if (gateOn && input.dryRun) {
    const waiting = await pendingMlBomCodes(tx, companyId);
    v.result.boms.forEach((b, i) => {
      if (b.action !== 'revise') return;
      noteOnRows(
        v,
        i,
        b.code && waiting.has(b.code)
          ? `${b.code} already has a change waiting for approval — it will not be sent`
          : `${b.code} will be sent for approval — it changes only when an approver approves it`,
      );
    });
  }

  if (input.dryRun || !v.result.ok) return v.result;
  return saveImport(tx, companyId, input, user, v, gateOn);
}

/** Codes of this company's ML-BOMs with an edit waiting for approval — ONE
 *  read per Preview (the request row carries the BOM code, unique per company). */
async function pendingMlBomCodes(tx: DbTransaction, companyId: string): Promise<Set<string>> {
  const rows = await tx
    .select({ docCode: documentEditRequests.docCode })
    .from(documentEditRequests)
    .where(
      and(
        eq(documentEditRequests.companyId, companyId),
        eq(documentEditRequests.entity, 'MlBom'),
        eq(documentEditRequests.status, 'pending'),
        isNull(documentEditRequests.deletedAt),
      ),
    );
  return new Set(rows.map((r) => r.docCode));
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

/** Add a message to every sheet row of BOM `bomIndex`; an ok row becomes a
 *  warning so the import screen shows it. */
function noteOnRows(v: ImportValidation, bomIndex: number, message: string): void {
  const nums = new Set(v.bomRowNums[bomIndex] ?? []);
  for (const r of v.result.rows) {
    if (!nums.has(r.rowNum)) continue;
    r.messages.push(message);
    if (r.status === 'ok') r.status = 'warning';
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
  outcome: MlBomImportOutcome;
  outcomeMessage: string | null;
}

async function saveImport(
  tx: DbTransaction,
  companyId: string,
  input: MlBomImportInput,
  user: AuthContext,
  v: ImportValidation,
  gateOn: boolean,
): Promise<MlBomImportSaveResult> {
  const note = `Imported from ${input.fileName}`;
  const saved = new Map<string, SavedBom>();
  const touched: string[] = [];

  for (const p of bottomUp(v.plans)) {
    if (p.existing && gateOn) {
      const staged = await stageRevise(tx, p, note, user);
      if (staged) {
        saved.set(p.item.id, staged);
        continue;
      }
      // null = the engine says "not staged" (cannot happen with the gate on
      // and the BOM live) — then the direct revise below is the rule.
    }
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
        // D2: an import is never refused for a missing Drawing Rev.
        { requireRev: false },
      );
      touched.push(r.header.id);
      saved.set(p.item.id, {
        id: r.header.id,
        code: r.header.code,
        revision: r.newRevision,
        revised: r,
        outcome: 'saved',
        outcomeMessage: null,
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
        { requireRev: false },
      );
      touched.push(r.header.id, ...r.relinked);
      saved.set(p.item.id, {
        id: r.header.id,
        code: r.header.code,
        revision: 1,
        revised: null,
        outcome: 'saved',
        outcomeMessage: null,
      });
    }
  }

  // After ALL writes: no loop, nothing deeper than the cap — else 409 and
  // the whole file rolls back.
  await guardAll(tx, companyId, touched);

  // History (ADR-197): a revise writes exactly the rows a screen edit
  // writes — header (BOM Rev) plus one before → after row per changed line —
  // with the file named; a create writes its CREATE row. A staged BOM has
  // its REQUEST row from the engine; a refused one has none (nothing done).
  for (const p of v.plans) {
    const s = saved.get(p.item.id)!;
    if (s.outcome !== 'saved') continue;
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

  v.plans.forEach((p, i) => {
    const msg = saved.get(p.item.id)?.outcomeMessage;
    if (msg) noteOnRows(v, i, msg);
  });
  const all = [...saved.values()];
  return {
    ...v.result,
    saved: true,
    boms: v.result.boms.map((b, i) => {
      const s = saved.get(v.plans[i]!.item.id);
      return s
        ? {
            ...b,
            code: s.code,
            revision: s.revision,
            outcome: s.outcome,
            outcomeMessage: s.outcomeMessage,
          }
        : b;
    }),
    sentForApprovalCount: all.filter((s) => s.outcome === 'sent_for_approval').length,
    notSentCount: all.filter((s) => s.outcome === 'not_sent').length,
  };
}

/**
 * Stage one revise for approval inside the import's transaction (savepoint).
 * A refusal (already waiting, nothing changed, a line the save would refuse,
 * changed since the check) is caught HERE and reported on this BOM only —
 * the savepoint has already undone just this request.
 * null = not staged (gate off / not live) — the caller revises directly.
 */
async function stageRevise(
  tx: DbTransaction,
  p: BomPlan,
  note: string,
  user: AuthContext,
): Promise<SavedBom | null> {
  const existing = p.existing!;
  const input = { itemId: p.item.id, lines: p.lines, revisionNote: note };
  const payload: MlBomEditPayload = { op: 'revise', input, requireRev: false };
  const base = { id: existing.id, code: existing.code, revision: existing.revision, revised: null };
  try {
    const requestId = await requestDocumentEditIdInTx(
      tx,
      'MlBom',
      existing.id,
      payload,
      existing.updatedAt,
      user,
      (stx, target) => precheckMlBomRevise(stx, target, input),
    );
    if (!requestId) return null;
    return {
      ...base,
      outcome: 'sent_for_approval',
      outcomeMessage: `${existing.code} sent for approval — not changed until an approver approves it`,
    };
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    return {
      ...base,
      outcome: 'not_sent',
      outcomeMessage: `${existing.code} not sent for approval: ${e.message}`,
    };
  }
}
