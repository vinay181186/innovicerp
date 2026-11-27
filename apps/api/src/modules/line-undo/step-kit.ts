// ADR-324 line undo — the small shared pieces of the Undo list builders.

import {
  CANCEL_DOC_LABELS,
  CANCEL_DOC_TYPES,
  type CancelBlocker,
  type CancelDocType,
  type LineUndoStep,
  opSrNo,
} from '@innovic/shared';
import { sql, type SQL } from 'drizzle-orm';
import type { DbTransaction } from '../../db/with-user-context';

/** What the run endpoint needs beyond the step the screen sees. */
export type StepRun =
  | {
      kind: 'stop_op';
      runningOpId: string;
      operatorId: string | null;
      operatorName: string | null;
      shift: string;
    }
  | { kind: 'reverse_op_log'; opLogId: string }
  | { kind: 'return_party_issue'; issueId: string; qty: number }
  | { kind: 'cancel'; docType: CancelDocType; docId: string }
  | { kind: 'manual' };

export interface BuiltStep {
  step: LineUndoStep;
  run: StepRun;
}

export const ids = (list: readonly string[]): SQL =>
  sql.join(
    list.map((x) => sql`${x}::uuid`),
    sql`, `,
  );

export async function q<T>(tx: DbTransaction, query: SQL): Promise<T[]> {
  return (await tx.execute(query)) as unknown as T[];
}

export const opRef = (seq: number, operation: string | null): string =>
  `Op ${opSrNo(seq)}${operation ? ` ${operation}` : ''}`;

export const LABEL_TO_TYPE = new Map<string, CancelDocType>(
  CANCEL_DOC_TYPES.map((t) => [CANCEL_DOC_LABELS[t], t]),
);

export function cancelStep(
  docType: CancelDocType,
  docId: string,
  docCode: string,
  href: string | null,
  whatHappens: string,
  actionLabel = 'Cancel',
): BuiltStep {
  return {
    step: {
      key: `cancel:${docType}:${docId}`,
      kind: 'cancel',
      docType,
      docId,
      docLabel: CANCEL_DOC_LABELS[docType],
      docCode,
      whatHappens,
      actionLabel,
      href,
      needsApproval: false,
      state: 'todo',
      manualReason: null,
    },
    run: { kind: 'cancel', docType, docId },
  };
}

export function manualStep(key: string, docId: string, b: CancelBlocker): BuiltStep {
  const docType = LABEL_TO_TYPE.get(b.docLabel) ?? null;
  return {
    step: {
      key,
      kind: 'cancel',
      docType,
      docId,
      docLabel: b.docLabel,
      docCode: b.docNo,
      whatHappens: b.reason,
      actionLabel: 'Open',
      href: b.href,
      needsApproval: false,
      state: 'manual',
      manualReason: `${b.reason} — cancel it on its own screen`,
    },
    run: { kind: 'manual' },
  };
}

