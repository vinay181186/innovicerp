// Item Issue — what a slip is issued against, and the To Issue cap
// (ADR-193 phase 3b, spec §11 paper tests M1–M3, M10).
//
//   job_card     the JC must exist; when it has an RM requirement, a line of
//                the RM item over its To Issue needs confirmation
//   assembly_so  an Equipment SO with a live BOM; only BOM parts; every part
//                over its To Issue needs confirmation
//   general      Department required
//
// "Needs confirmation" = 409 { needsConfirmation, over[] } unless the caller
// sent confirmReason AND holds issue_create 'approve'. The numbers come from
// lib/material-requirement.ts — the same ones the Material view shows.

import { ISSUE_AGAINST_LABELS, type CreateStoreIssueInput } from '@innovic/shared';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { hasFormAccess } from '../../lib/access';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import {
  balanceOf,
  jcRequirement,
  readBomParts,
  readIssuedReturned,
  readJcHead,
  readSoHead,
} from '../../lib/material-requirement';
import { roundQty } from '../../lib/stock-ledger';

export interface IssueTarget {
  jobCardId: string | null;
  productionOrderId: string | null;
  salesOrderId: string | null;
  department: string | null;
  /** "Job Card JC-0012" / "Assembly SO IN-SO-00012" / "General / Consumable · Maintenance". */
  label: string;
}

export interface OverLine {
  itemCode: string;
  toIssueQty: number;
  qty: number;
}

/**
 * Resolve the target and check every line against its To Issue. Call AFTER the
 * items are locked, so a concurrent issue on the same item has committed and
 * is counted in Issued.
 */
export async function resolveTargetAndCap(
  tx: DbTransaction,
  companyId: string,
  input: CreateStoreIssueInput,
  itemCodes: Map<string, string>,
): Promise<{ target: IssueTarget; over: OverLine[] }> {
  const department = input.department?.trim() || null;
  const over: OverLine[] = [];

  if (input.issueAgainst === 'job_card') {
    const jc = await readJcHead(tx, companyId, input.jobCardId!);
    if (!jc) throw new NotFoundError('Job Card not found. Pick the Job Card again.');
    const req = jcRequirement(jc);
    if (req) {
      const line = input.lines.find((l) => l.itemId === req.itemId);
      if (line) {
        const got = await readIssuedReturned(tx, companyId, { jobCardId: jc.id });
        const toIssueQty = balanceOf(req.required, got.get(req.itemId));
        if (roundQty(line.qty) > toIssueQty) {
          over.push({ itemCode: itemCodes.get(line.itemId) ?? '', toIssueQty, qty: line.qty });
        }
      }
    }
    return {
      target: {
        jobCardId: jc.id,
        productionOrderId: jc.productionOrderId,
        salesOrderId: null,
        department,
        label: `${ISSUE_AGAINST_LABELS.job_card} ${jc.code}`,
      },
      over,
    };
  }

  if (input.issueAgainst === 'assembly_so') {
    const so = await readSoHead(tx, companyId, input.salesOrderId!);
    if (!so) throw new NotFoundError('Sales Order not found. Pick the Assembly SO again.');
    if (so.status === 'cancelled' || so.status === 'closed') {
      throw new ValidationError(`${so.code} is ${so.status} — it takes no more issues`);
    }
    if (!so.isEquipment || !so.bomId) {
      throw new ValidationError('Issue against an Assembly SO needs an Equipment SO with a BOM');
    }
    const parts = await readBomParts(tx, companyId, so.bomId, so.units);
    for (const l of input.lines) {
      if (!parts.has(l.itemId)) {
        throw new ValidationError(
          `${itemCodes.get(l.itemId) ?? 'This item'} is not a BOM part of ${so.code} — issue it as General`,
        );
      }
    }
    const got = await readIssuedReturned(tx, companyId, { salesOrderId: so.id });
    for (const l of input.lines) {
      const part = parts.get(l.itemId)!;
      const toIssueQty = balanceOf(part.required, got.get(l.itemId));
      if (roundQty(l.qty) > toIssueQty) {
        over.push({ itemCode: itemCodes.get(l.itemId) ?? '', toIssueQty, qty: l.qty });
      }
    }
    return {
      target: {
        jobCardId: null,
        productionOrderId: null,
        salesOrderId: so.id,
        department,
        label: `${ISSUE_AGAINST_LABELS.assembly_so} ${so.code}`,
      },
      over,
    };
  }

  if (!department) throw new ValidationError('Enter the Department that uses it');
  return {
    target: {
      jobCardId: null,
      productionOrderId: null,
      salesOrderId: null,
      department,
      label: `${ISSUE_AGAINST_LABELS.general} · ${department}`,
    },
    over,
  };
}

/** Throw unless an more-than-To-Issue issue is confirmed by an approve-tier user. */
export async function enforceOverToIssue(
  user: AuthContext,
  over: OverLine[],
  confirmReason: string | undefined,
): Promise<string | null> {
  if (over.length === 0) return null;
  const reason = confirmReason?.trim() ?? '';
  if (!reason) {
    const what = over
      .map((o) => `${o.itemCode}: Issue Qty ${o.qty}, To Issue ${o.toIssueQty}`)
      .join('; ');
    throw new ConflictError(
      `This issue is more than To Issue (${what}). An approver must confirm it with a reason.`,
      { needsConfirmation: true, over },
    );
  }
  if (!(await hasFormAccess(user, 'issue_create', 'approve'))) {
    throw new AuthorizationError(
      'Issuing more than To Issue needs an approver (Approve on Item Issue). Ask an approver to post this issue.',
    );
  }
  return reason;
}
