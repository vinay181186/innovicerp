// store-transactions transform — legacy `storeTransactions` to Postgres
// `store_transactions`. Append-only ledger; no header. 2 source records.
//
// Field mapping:
//   id          → _legacyId, uuidv5 → id
//   date        → txn_date
//   itemCode    → item_id (via byCode.items) + item_code_text fallback
//   type        → txn_type (legacy 'IN' → 'in', 'OUT' → 'out')
//   qty         → qty (always positive; sign comes from txn_type)
//   source      → source_type (legacy 'GRN QC' → 'grn_qc', etc.) +
//                 source_ref (refNo)
//   refNo       → source_ref
//   stockBefore → stock_before
//   stockAfter  → stock_after
//   remarks     → remarks
//
// Anomalies:
//   - itemCode unresolved → item_code_text fallback (NOT skipped per ADR-012 #10)
//   - type unrecognised → defaulted to 'in' with anomaly + dropped
//   - source unrecognised → defaulted to 'other' with anomaly
//   - qty <= 0 → skip
//   - stockAfter mismatch (vs stockBefore ± qty) → load anyway + anomaly

import { v5 as uuidv5 } from 'uuid';
import { MIGRATION_UUID_NAMESPACE } from '../uuid-namespace';
import type { Anomaly, TransformContext, TransformResult } from './types';

interface LegacyStoreTxnDoc {
  id: string;
  date?: string;
  itemCode?: string;
  type?: string;
  qty?: number;
  source?: string;
  refNo?: string;
  remarks?: string;
  stockBefore?: number;
  stockAfter?: number;
}

export interface TransformedStoreTransaction {
  _legacyId: string;
  id: string;
  txnDate: string;
  itemId: string | null;
  itemCodeText: string | null;
  txnType: 'in' | 'out' | 'adjust';
  qty: number;
  sourceType:
    | 'grn_qc'
    | 'manual_adjust'
    | 'dispatch'
    | 'jw_in'
    | 'jw_out'
    | 'other';
  sourceRef: string;
  stockBefore: number;
  stockAfter: number;
  remarks: string | null;
}

export function legacyStoreTxnUuid(legacyId: string): string {
  return uuidv5(`store_transactions/${legacyId}`, MIGRATION_UUID_NAMESPACE);
}

function emptyToNull(s: string | undefined): string | null {
  if (s === undefined) return null;
  const trimmed = s.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function normaliseTxnType(
  raw: string | undefined,
): { type: 'in' | 'out' | 'adjust'; unrecognised?: string } {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'in') return { type: 'in' };
  if (v === 'out') return { type: 'out' };
  if (v === 'adjust' || v === 'adjustment') return { type: 'adjust' };
  if (raw === undefined) return { type: 'in' };
  return { type: 'in', unrecognised: raw };
}

function normaliseSourceType(
  raw: string | undefined,
): {
  type: 'grn_qc' | 'manual_adjust' | 'dispatch' | 'jw_in' | 'jw_out' | 'other';
  unrecognised?: string;
} {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'grn qc' || v === 'grn_qc') return { type: 'grn_qc' };
  if (v === 'manual adjust' || v === 'manual_adjust' || v === 'manual') {
    return { type: 'manual_adjust' };
  }
  if (v === 'dispatch') return { type: 'dispatch' };
  if (v === 'jw in' || v === 'jw_in') return { type: 'jw_in' };
  if (v === 'jw out' || v === 'jw_out') return { type: 'jw_out' };
  if (v === 'other' || v === '' || raw === undefined) return { type: 'other' };
  return { type: 'other', unrecognised: raw };
}

export function transformStoreTransactions(
  records: LegacyStoreTxnDoc[],
  ctx: TransformContext,
): TransformResult<TransformedStoreTransaction> {
  const rows: TransformedStoreTransaction[] = [];
  const anomalies: Anomaly[] = [];

  const itemsByCode = ctx.lookups.byCode['items'];

  for (const r of records) {
    if (!r.date) {
      anomalies.push({ legacyId: r.id, type: 'date_missing' });
      continue;
    }
    if (typeof r.qty !== 'number' || r.qty <= 0) {
      anomalies.push({
        legacyId: r.id,
        type: 'qty_invalid',
        details: { qty: r.qty },
      });
      continue;
    }

    const { type: txnType, unrecognised: txnUnrecognised } = normaliseTxnType(r.type);
    if (txnUnrecognised) {
      anomalies.push({
        legacyId: r.id,
        type: 'txn_type_unrecognised',
        details: { from: txnUnrecognised, defaultedTo: txnType },
      });
    }

    const { type: sourceType, unrecognised: srcUnrecognised } = normaliseSourceType(r.source);
    if (srcUnrecognised) {
      anomalies.push({
        legacyId: r.id,
        type: 'source_type_unrecognised',
        details: { from: srcUnrecognised, defaultedTo: sourceType },
      });
    }

    const sourceRef = (r.refNo ?? '').trim();
    if (!sourceRef) {
      anomalies.push({
        legacyId: r.id,
        type: 'source_ref_missing',
      });
      continue;
    }

    const itemCodeRaw = r.itemCode?.trim() ?? '';
    const itemId = itemCodeRaw ? itemsByCode?.get(itemCodeRaw) ?? null : null;
    const itemCodeText = itemCodeRaw && !itemId ? itemCodeRaw : null;

    const stockBefore = typeof r.stockBefore === 'number' ? r.stockBefore : 0;
    const stockAfter = typeof r.stockAfter === 'number' ? r.stockAfter : stockBefore;

    // Sanity-check stockAfter against expected math; load anyway on mismatch.
    const expectedDelta = txnType === 'in' ? r.qty : txnType === 'out' ? -r.qty : 0;
    if (txnType !== 'adjust' && stockAfter !== stockBefore + expectedDelta) {
      anomalies.push({
        legacyId: r.id,
        type: 'stock_arithmetic_mismatch',
        details: { stockBefore, qty: r.qty, txnType, stockAfter, expected: stockBefore + expectedDelta },
      });
    }

    rows.push({
      _legacyId: r.id,
      id: legacyStoreTxnUuid(r.id),
      txnDate: r.date,
      itemId,
      itemCodeText,
      txnType,
      qty: r.qty,
      sourceType,
      sourceRef,
      stockBefore,
      stockAfter,
      remarks: emptyToNull(r.remarks),
    });
  }

  return {
    table: 'store_transactions',
    sourceCollection: 'storeTransactions',
    transformedAt: new Date().toISOString(),
    rows,
    anomalies,
  };
}
