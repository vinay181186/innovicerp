// Raw-material SIZE master (migration 0105). One half of the "Raw Material
// Master" menu entry; the other is ../material-grades. The two are deliberately
// INDEPENDENT — a size is not scoped to a grade, so picking EN24 does not
// narrow the size list.
//
// The size is ONE free box, by decision: whatever the buyer writes on the
// cutting slip goes in verbatim ('Ø30 × 1000'), not split into shape/dia/length.
//
// Shaped on ../operators: same list / create / update / soft-delete / bulk
// import shape, same tier gate, same auto code series. Everything here is gated
// on the single form key `rawmat_create` (Production), because Grade and Size
// are two tabs of one screen in the user's head.

import { and, asc, count, eq, ilike, isNull, like, or, sql, type SQL } from 'drizzle-orm';
import { materialSizes } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { withUniqueRetry } from '../../lib/db-retry';
import { AuthorizationError, ConflictError, NotFoundError } from '../../lib/errors';
import type {
  BulkCreateMaterialSizesInput,
  BulkCreateMaterialSizesResponse,
  BulkMaterialSizeSkip,
  CreateMaterialSizeInput,
  ListMaterialSizesQuery,
  ListMaterialSizesResponse,
  MaterialSize,
  UpdateMaterialSizeInput,
} from './schema';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

function emptyToNull(s: string | undefined): string | null {
  if (s === undefined) return null;
  const trimmed = s.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export async function listMaterialSizes(
  input: ListMaterialSizesQuery,
  user: AuthContext,
): Promise<ListMaterialSizesResponse> {
  await requireFormAccess(user, 'rawmat_create', 'view');
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const conditions: SQL[] = [
      eq(materialSizes.companyId, companyId),
      isNull(materialSizes.deletedAt),
    ];
    if (input.search) {
      const s = or(
        ilike(materialSizes.code, `%${input.search}%`),
        ilike(materialSizes.name, `%${input.search}%`),
      );
      if (s) conditions.push(s);
    }
    if (typeof input.isActive === 'boolean') {
      conditions.push(eq(materialSizes.isActive, input.isActive));
    }

    const where = and(...conditions);

    const [rows, totals] = await Promise.all([
      tx
        .select()
        .from(materialSizes)
        .where(where)
        .orderBy(asc(materialSizes.code))
        .limit(input.limit)
        .offset(input.offset),
      tx.select({ value: count() }).from(materialSizes).where(where),
    ]);

    return {
      sizes: rows as unknown as MaterialSize[],
      total: totals[0]?.value ?? 0,
      limit: input.limit,
      offset: input.offset,
    };
  });
}

export async function getMaterialSize(id: string, user: AuthContext): Promise<MaterialSize> {
  await requireFormAccess(user, 'rawmat_create', 'view');
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(materialSizes)
      .where(
        and(
          eq(materialSizes.id, id),
          eq(materialSizes.companyId, companyId),
          isNull(materialSizes.deletedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError(`Material size ${id} not found`);
    return row as unknown as MaterialSize;
  });
}

/** Next SZ-#### in the company series. Server-authoritative so size codes
 *  auto-generate instead of being typed. Deleted rows still hold their code —
 *  the scan is NOT soft-delete filtered, so a code is never re-issued. */
async function nextMaterialSizeCode(tx: DbTransaction, companyId: string): Promise<string> {
  const rows = await tx
    .select({ code: materialSizes.code })
    .from(materialSizes)
    .where(and(eq(materialSizes.companyId, companyId), like(materialSizes.code, 'SZ-%')))
    .orderBy(sql`length(${materialSizes.code}) desc`, sql`${materialSizes.code} desc`)
    .limit(1);
  const last = rows[0]?.code ?? null;
  let next = 1;
  if (last) {
    const m = last.match(/^SZ-(\d+)$/i);
    if (m) next = Number(m[1]) + 1;
  }
  return `SZ-${String(next).padStart(4, '0')}`;
}

export async function createMaterialSize(
  input: CreateMaterialSizeInput,
  user: AuthContext,
): Promise<MaterialSize> {
  // L2 Data Entry and up in Production can add a size; L1 Viewer cannot.
  await requireFormAccess(user, 'rawmat_create', 'entry');
  const companyId = requireCompany(user);
  // withUniqueRetry re-runs in a fresh transaction if two concurrent creates
  // collide on material_sizes_company_code_uniq (23505) — e.g. both
  // auto-generate the same SZ-#### — so the loser retries with the next code
  // instead of 500ing.
  return withUniqueRetry(() =>
    withUserContext(user, async (tx) => {
      const code = input.code?.trim() || (await nextMaterialSizeCode(tx, companyId));
      const existing = await tx
        .select({ id: materialSizes.id, deletedAt: materialSizes.deletedAt })
        .from(materialSizes)
        .where(and(eq(materialSizes.companyId, companyId), eq(materialSizes.code, code)))
        .limit(1);
      const dup = existing[0];
      if (dup) {
        if (dup.deletedAt) {
          throw new ConflictError(
            `Material size code "${code}" belongs to a deleted size — restore it instead of re-creating`,
          );
        }
        throw new ConflictError(`Material size code "${code}" already exists`);
      }

      const inserted = await tx
        .insert(materialSizes)
        .values({
          companyId,
          code,
          name: input.name.trim(),
          description: emptyToNull(input.description),
          isActive: input.isActive,
          createdBy: user.id,
          updatedBy: user.id,
        })
        .returning();
      return inserted[0] as unknown as MaterialSize;
    }),
  );
}

/**
 * Create many sizes in ONE transaction — the Excel importer's whole sheet.
 *
 * Same shape as createOperatorsBulk / the vendor + item + client importers, and
 * for the same reason: row-at-a-time importing paid one access check, one
 * transaction, one duplicate-check query and one list reload PER ROW, which ran
 * at roughly a row a second and got slower as the master grew.
 *
 * The per-row work is done ONCE here:
 *   - one access check, one transaction, one RLS context set;
 *   - existing codes and names read in a single query;
 *   - the SZ-#### series continued in memory instead of re-scanning the table;
 *   - one multi-row INSERT (chunked) instead of N.
 *
 * Tolerant, not all-or-nothing: a bad row is reported in `skipped[]` with a
 * plain-English reason and left out; the rest go in. One duplicate in a sheet
 * should not cost the operator the other 499 rows.
 */
export async function createMaterialSizesBulk(
  input: BulkCreateMaterialSizesInput,
  user: AuthContext,
): Promise<BulkCreateMaterialSizesResponse> {
  // Same gate as a single create — this raises sizes, so it is `entry`.
  await requireFormAccess(user, 'rawmat_create', 'entry');
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    // One read of what already exists, rather than a duplicate-check per row.
    // Deleted rows are included on purpose: their CODE is still taken (the
    // single create refuses to reuse it), so the series must skip past them.
    const existingRows = await tx
      .select({
        code: materialSizes.code,
        name: materialSizes.name,
        deletedAt: materialSizes.deletedAt,
      })
      .from(materialSizes)
      .where(eq(materialSizes.companyId, companyId));

    const takenCodes = new Set(existingRows.map((r) => r.code.trim().toLowerCase()));
    // DE-DUP KEY: the size NAME, case-insensitive — the size text itself. The
    // import template has no Code column, so the name is the only thing a re-run
    // of the same file can recognise itself by. Checking it here compares each
    // row against every size in the company; the import screen could only
    // compare against the page it had loaded, so anything past that page read
    // as "new".
    // Live rows only — a deleted size's name is free to use again.
    const takenNames = new Set(
      existingRows.filter((r) => !r.deletedAt).map((r) => r.name.trim().toLowerCase()),
    );

    // Continue the SZ-#### series in memory. nextMaterialSizeCode() scans the
    // table for the highest code; doing that per row is one query per size.
    let nextSeq = 0;
    for (const r of existingRows) {
      const m = /^SZ-(\d+)$/i.exec(r.code.trim());
      if (m) nextSeq = Math.max(nextSeq, Number(m[1]));
    }

    const skipped: BulkMaterialSizeSkip[] = [];
    const values: Array<typeof materialSizes.$inferInsert> = [];
    const codes: string[] = [];

    for (const [i, g] of input.sizes.entries()) {
      const index = i + 1;
      const name = g.name.trim();
      const nameKey = name.toLowerCase();
      if (name.length === 0) {
        skipped.push({ index, name, reason: 'the size is blank' });
        continue;
      }
      if (takenNames.has(nameKey)) {
        skipped.push({ index, name, reason: 'a size with this name already exists' });
        continue;
      }

      let code = g.code?.trim();
      if (code) {
        if (takenCodes.has(code.toLowerCase())) {
          skipped.push({ index, name, reason: `code "${code}" is already used` });
          continue;
        }
      } else {
        nextSeq += 1;
        code = `SZ-${String(nextSeq).padStart(4, '0')}`;
        // Defensive: a company holding a hand-typed SZ-0007 alongside the
        // series could collide. Walk forward until the code is free.
        while (takenCodes.has(code.toLowerCase())) {
          nextSeq += 1;
          code = `SZ-${String(nextSeq).padStart(4, '0')}`;
        }
      }
      // Claim both keys so a duplicate INSIDE the sheet is caught too, not just
      // one against what was already stored.
      takenCodes.add(code.toLowerCase());
      takenNames.add(nameKey);

      values.push({
        companyId,
        code,
        name,
        description: emptyToNull(g.description),
        isActive: g.isActive,
        createdBy: user.id,
        updatedBy: user.id,
      });
      codes.push(code);
    }

    if (values.length > 0) {
      // One statement for the lot. Chunked because a single INSERT carries one
      // parameter per column per row and Postgres caps a statement at 65535.
      const CHUNK = 500;
      for (let i = 0; i < values.length; i += CHUNK) {
        await tx.insert(materialSizes).values(values.slice(i, i + CHUNK));
      }
    }

    return { created: values.length, skipped, codes };
  });
}

export async function updateMaterialSize(
  id: string,
  input: UpdateMaterialSizeInput,
  user: AuthContext,
): Promise<MaterialSize> {
  // Changing a saved size is `edit`, so L2 (create-only) is correctly refused.
  await requireFormAccess(user, 'rawmat_create', 'edit');
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: materialSizes.id })
      .from(materialSizes)
      .where(
        and(
          eq(materialSizes.id, id),
          eq(materialSizes.companyId, companyId),
          isNull(materialSizes.deletedAt),
        ),
      )
      .limit(1);
    if (existing.length === 0) throw new NotFoundError(`Material size ${id} not found`);

    const updates: Record<string, unknown> = { updatedBy: user.id };
    if (input.name !== undefined) updates.name = input.name.trim();
    if (input.description !== undefined) updates.description = emptyToNull(input.description);
    if (input.isActive !== undefined) updates.isActive = input.isActive;

    const updated = await tx
      .update(materialSizes)
      .set(updates)
      .where(eq(materialSizes.id, id))
      .returning();
    return updated[0] as unknown as MaterialSize;
  });
}

export async function softDeleteMaterialSize(id: string, user: AuthContext): Promise<{ ok: true }> {
  // Delete = the edit+approve pair only L5 Department Admin and above hold.
  await requireFormAccess(user, 'rawmat_create', 'edit');
  await requireFormAccess(user, 'rawmat_create', 'approve');
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: materialSizes.id })
      .from(materialSizes)
      .where(
        and(
          eq(materialSizes.id, id),
          eq(materialSizes.companyId, companyId),
          isNull(materialSizes.deletedAt),
        ),
      )
      .limit(1);
    if (existing.length === 0) throw new NotFoundError(`Material size ${id} not found`);
    // Soft delete only. Plans and Job Cards already holding this size keep
    // their text snapshot, so nothing they print changes.
    await tx
      .update(materialSizes)
      .set({ deletedAt: new Date(), updatedBy: user.id })
      .where(eq(materialSizes.id, id));
    return { ok: true };
  });
}
