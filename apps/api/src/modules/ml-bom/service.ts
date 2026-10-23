// Multi-Level BOM service (ADR-225 Phase 1). A SEPARATE document from BOM
// Master (modules/bom-master), which this module never writes.
//
// This file is the entry point the routes call: the access checks
// (`mlbom_create`, dept design) and the transaction. The work lives in
//   reads.ts   list / detail / next code
//   tree.ts    the one-query tree + exploded list
//   writes.ts  create / update / make default / delete
//   guards.ts  tree lock, link resolution, loop + depth guard
//   lines.ts   line rows, raw material, revision snapshot
//
// Audit (ADR-197): CREATE / EDIT / DELETE rows land in activity_log with
// entity 'MlBom' + entityId, so the BOM's History panel finds them.

import type { DocumentEditStagedResult } from '@innovic/shared';
import { requireDeleteRight, requireFormAccess } from '../../lib/access';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { ConflictError } from '../../lib/errors';
import type { DocEditTarget } from '../document-edits/registry';
import { requireCompany, validateItemAndLines } from './helpers';
import { loadRawMaterialNames } from './lines';
import type { MlBomEditPayload } from './ml-bom-edit-registry';
import { listMlBomsTx, loadMlBomDetail, nextMlBomCode } from './reads';
import { loadMlBomTree } from './tree';
import { makeDefaultMlBomTx, softDeleteMlBomTx } from './default-delete';
import { createMlBomTx, updateMlBomTx } from './writes';
import type {
  CreateMlBomInput,
  ListMlBomsQuery,
  ListMlBomsResponse,
  MakeDefaultMlBomInput,
  MlBom,
  MlBomDetail,
  MlBomTreeQuery,
  MlBomTreeResponse,
  UpdateMlBomInput,
} from './schema';

const FORM = 'mlbom_create';

// ─── Reads ───────────────────────────────────────────────────────────────

export async function listMlBoms(
  input: ListMlBomsQuery,
  user: AuthContext,
): Promise<ListMlBomsResponse> {
  await requireFormAccess(user, FORM, 'view');
  const companyId = requireCompany(user);
  return withUserContext(user, (tx) => listMlBomsTx(tx, companyId, input));
}

/** Preview of the next IN-MLB-##### — the real number is taken on save. */
export async function getNextMlBomCode(user: AuthContext): Promise<{ code: string }> {
  await requireFormAccess(user, FORM, 'view');
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => ({ code: await nextMlBomCode(tx, companyId) }));
}

export async function getMlBom(id: string, user: AuthContext): Promise<MlBomDetail> {
  await requireFormAccess(user, FORM, 'view');
  const companyId = requireCompany(user);
  return withUserContext(user, (tx) => loadMlBomDetail(tx, id, companyId));
}

export async function getMlBomTree(
  id: string,
  query: MlBomTreeQuery,
  user: AuthContext,
): Promise<MlBomTreeResponse> {
  await requireFormAccess(user, FORM, 'view');
  const companyId = requireCompany(user);
  return withUserContext(user, (tx) => loadMlBomTree(tx, companyId, id, query.qty));
}

// ─── Writes ──────────────────────────────────────────────────────────────

export async function createMlBom(
  input: CreateMlBomInput,
  user: AuthContext,
): Promise<MlBomDetail> {
  await requireFormAccess(user, FORM, 'entry');
  const companyId = requireCompany(user);
  return withUserContext(user, (tx) => createMlBomTx(tx, companyId, input, user));
}

export async function updateMlBom(
  id: string,
  input: UpdateMlBomInput,
  user: AuthContext,
): Promise<MlBomDetail> {
  await requireFormAccess(user, FORM, 'edit');
  const companyId = requireCompany(user);
  return withUserContext(user, (tx) => updateMlBomTx(tx, companyId, id, input, user));
}

/**
 * The checks a direct save would refuse with, run on a staged revise under the
 * locks loadForDiff took — so a request that could never be applied is refused
 * now, not at approval. (The loop / depth guard needs the lines written, so it
 * runs when the approval applies them.) Shared with the Excel import.
 */
export async function precheckMlBomRevise(
  tx: DbTransaction,
  target: DocEditTarget,
  input: UpdateMlBomInput,
): Promise<undefined> {
  const companyId = String(target.doc['companyId']);
  const itemId = String(target.doc['itemId']);
  if (input.itemId !== itemId) {
    throw new ConflictError(
      `${target.docCode}: the BOM item cannot be changed after save. Make a new ` +
        `Multi-Level BOM for the other item.`,
    );
  }
  await validateItemAndLines(tx, companyId, itemId, input.lines);
  await loadRawMaterialNames(tx, input.lines, companyId);
  return undefined;
}

/**
 * PUT /ml-boms/:id. Edit-approval (ADR-202, ADR-249 Step B2): with the gate on,
 * an edit of a live ML-BOM is staged (Remarks / BOM Lines boxes) and
 * {staged:true, request} returned; gate off → updateMlBom, as before.
 */
export async function updateMlBomOrStage(
  id: string,
  input: UpdateMlBomInput,
  user: AuthContext,
): Promise<MlBomDetail | DocumentEditStagedResult> {
  await requireFormAccess(user, FORM, 'edit');
  // Dynamic import: the engine's registry imports this module's writers.
  const { requestDocumentEdit } = await import('../document-edits/service');
  const payload: MlBomEditPayload = { op: 'revise', input };
  const request = await requestDocumentEdit(
    'MlBom',
    id,
    payload,
    input.expectedUpdatedAt,
    user,
    (tx, target) => precheckMlBomRevise(tx, target, input),
  );
  if (request) return { staged: true, request };
  return updateMlBom(id, input, user);
}

export async function makeDefaultMlBom(
  id: string,
  input: MakeDefaultMlBomInput,
  user: AuthContext,
): Promise<MlBomDetail> {
  await requireFormAccess(user, FORM, 'edit');
  const companyId = requireCompany(user);
  return withUserContext(user, (tx) => makeDefaultMlBomTx(tx, companyId, id, input, user));
}

/**
 * POST /ml-boms/:id/make-default. With the gate on, moving the Default is
 * staged as the "Default" box (approval moves BOTH rows in one transaction).
 * Already the Default → the detail back, nothing written or staged (as the
 * direct path does), never a "Nothing changed" refusal for a no-op click.
 */
export async function makeDefaultMlBomOrStage(
  id: string,
  input: MakeDefaultMlBomInput,
  user: AuthContext,
): Promise<MlBomDetail | DocumentEditStagedResult> {
  await requireFormAccess(user, FORM, 'edit');
  const companyId = requireCompany(user);
  const current = await withUserContext(user, (tx) => loadMlBomDetail(tx, id, companyId));
  if (current.isDefault) return current;
  const { requestDocumentEdit } = await import('../document-edits/service');
  const payload: MlBomEditPayload = { op: 'makeDefault' };
  const request = await requestDocumentEdit('MlBom', id, payload, input.expectedUpdatedAt, user);
  if (request) return { staged: true, request };
  return makeDefaultMlBom(id, input, user);
}

/** Same rule as BOM Master's delete: L6 Super Admin only (ADR-232). */
export async function softDeleteMlBom(
  id: string,
  user: AuthContext,
  reason?: string | null,
): Promise<MlBom> {
  await requireDeleteRight(user, 'Multi-Level BOMs');
  const companyId = requireCompany(user);
  return withUserContext(user, (tx) => softDeleteMlBomTx(tx, companyId, id, user, reason ?? null));
}
