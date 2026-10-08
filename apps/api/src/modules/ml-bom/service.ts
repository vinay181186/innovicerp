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

import { requireFormAccess } from '../../lib/access';
import { requireWriteRole } from '../../lib/auth';
import { AuthorizationError } from '../../lib/errors';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireCompany } from './helpers';
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
  requireWriteRole(user);
  await requireFormAccess(user, FORM, 'entry');
  const companyId = requireCompany(user);
  return withUserContext(user, (tx) => createMlBomTx(tx, companyId, input, user));
}

export async function updateMlBom(
  id: string,
  input: UpdateMlBomInput,
  user: AuthContext,
): Promise<MlBomDetail> {
  requireWriteRole(user);
  await requireFormAccess(user, FORM, 'edit');
  const companyId = requireCompany(user);
  return withUserContext(user, (tx) => updateMlBomTx(tx, companyId, id, input, user));
}

export async function makeDefaultMlBom(
  id: string,
  input: MakeDefaultMlBomInput,
  user: AuthContext,
): Promise<MlBomDetail> {
  requireWriteRole(user);
  await requireFormAccess(user, FORM, 'edit');
  const companyId = requireCompany(user);
  return withUserContext(user, (tx) => makeDefaultMlBomTx(tx, companyId, id, input, user));
}

/** Same rule as BOM Master's delete: admin only, with Edit + Approve. */
export async function softDeleteMlBom(
  id: string,
  user: AuthContext,
  reason?: string | null,
): Promise<MlBom> {
  if (user.role !== 'admin') {
    throw new AuthorizationError(
      'You do not have permission to delete Multi-Level BOMs. Ask an admin.',
    );
  }
  await requireFormAccess(user, FORM, 'edit');
  await requireFormAccess(user, FORM, 'approve');
  const companyId = requireCompany(user);
  return withUserContext(user, (tx) => softDeleteMlBomTx(tx, companyId, id, user, reason ?? null));
}
