// ADR-306 — the SO No. (sales_orders.code), the order's ONE number:
//   - an Internal SO No. typed on the form (digits, 433) gives SO-433;
//   - left blank, the order gets the next IN-SO-##### of the system series;
//   - a later change of the typed number renames the SO No.; migration 0254's
//     trigger (sales_orders_code_change) then rewrites every saved copy and
//     keeps the old number in legacy_code, all in the same transaction.
// A number is never given twice: every check below reads EVERY SO of the
// company, deleted ones included, and every number an SO ever had.
// Callers that write take lockDocSeries('sales_orders') first (CLAUDE.md §20).

import {
  type SoNoCheckQuery,
  type SoNoCheckResponse,
  internalSoNoError,
  internalSoNoTakenMessage,
  soNoFromInternal,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';

import type { DbTransaction } from '../../db/with-user-context';
import { ConflictError, ValidationError } from '../../lib/errors';

const SYSTEM_PREFIX = 'IN-SO-';
const SYSTEM_DIGITS = 5;

/** The next IN-SO-##### — the highest system number the company ever used
 *  (on an SO's code or among its earlier numbers in legacy_code, deleted SOs
 *  too) + 1. numeric, not bigint, so no stored value can overflow it. */
export async function nextSystemSoNo(tx: DbTransaction, companyId: string): Promise<string> {
  const rows = await tx.execute<{ n: string }>(sql`
    SELECT (COALESCE(MAX((m)[1]::numeric), 0) + 1)::text AS n
    FROM public.sales_orders s,
         regexp_matches(s.code || ' ' || COALESCE(s.legacy_code, ''),
                        '(?:^| )IN-SO-([0-9]+)(?= |$)', 'g') AS m
    WHERE s.company_id = ${companyId}`);
  return `${SYSTEM_PREFIX}${String(rows[0]?.n ?? '1').padStart(SYSTEM_DIGITS, '0')}`;
}

/** The SO No. of the order that holds `soNo` now or held it before, else
 *  null. `excludeId` is the SO being edited (its own numbers are fine). */
export async function soNoHolder(
  tx: DbTransaction,
  companyId: string,
  soNo: string,
  excludeId?: string,
): Promise<string | null> {
  // SO-433 also matches SO-0433 (a number typed with zeros before ADR-306).
  // `digits` is digits only, so it is safe inside the pattern.
  const digits = soNo.replace(/^SO-0*/i, '');
  const exact = `^so-0*${digits}$`;
  const token = `(^| )so-0*${digits}( |$)`;
  const rows = await tx.execute<{ code: string }>(sql`
    SELECT code FROM public.sales_orders
    WHERE company_id = ${companyId}
      ${excludeId ? sql`AND id <> ${excludeId}` : sql``}
      AND (lower(code) ~ ${exact}
           OR lower(COALESCE(internal_so_no, '')) ~ ${exact}
           OR lower(COALESCE(legacy_code, '')) ~ ${token})
    LIMIT 1`);
  return rows[0]?.code ?? null;
}

/** 400 on a badly typed number, 409 when another SO has (or had) it. Returns
 *  the SO No. the typed digits give ("433" -> "SO-433"). */
export async function assertTypedSoNoFree(
  tx: DbTransaction,
  companyId: string,
  typed: string,
  excludeId?: string,
): Promise<string> {
  const err = internalSoNoError(typed);
  if (err) throw new ValidationError(err);
  const soNo = soNoFromInternal(typed);
  if (!/^SO-\d+$/.test(soNo))
    throw new ValidationError('Internal SO No.: type digits only (e.g. 433).');
  const holder = await soNoHolder(tx, companyId, soNo, excludeId);
  if (holder) throw new ConflictError(internalSoNoTakenMessage(soNo, holder));
  return soNo;
}

/** The live check the SO form runs while typing. Read-only; the save checks
 *  again under the series lock. */
export async function checkSoNo(
  tx: DbTransaction,
  companyId: string,
  q: SoNoCheckQuery,
): Promise<SoNoCheckResponse> {
  const error = internalSoNoError(q.internalSoNo);
  if (error) return { soNo: null, error, taken: false, usedBy: null };
  const soNo = soNoFromInternal(q.internalSoNo);
  const usedBy = await soNoHolder(tx, companyId, soNo, q.excludeId);
  return { soNo, error: null, taken: usedBy !== null, usedBy };
}
