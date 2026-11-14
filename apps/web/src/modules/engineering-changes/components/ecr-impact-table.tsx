// ADR-291 — the ECR "Impact" table: every SO / JWSO line, Job Card and stock
// row of the old Rev that Submit found, with what happens to it. While the ECR
// is Waiting Approval a user with the right picks a Disposition per row and,
// for "Move not-started qty to new Rev", the Move Qty (≤ Qty Not Started);
// "Save Dispositions" sends them in one request with the ECR's updatedAt
// (§20.4 — 409 when someone saved first). After Implement each moved row
// shows the new Production Order / Job Card.

import {
  ECR_DISPOSITIONS,
  ECR_DISPOSITION_LABELS,
  type Ecr,
  type EcrDisposition,
  type EcrImpact,
} from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useSaveKey } from '@/lib/use-save-key';
import { DataTable, Panel, type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { useToast } from '@/ui/feedback';
import { Input, Select } from '@/ui/forms';
import { useSetEcrDispositions } from '../api';

interface RowEdit {
  disposition: EcrDisposition | null;
  moveQty: string;
  note: string;
}

const DISPOSITION_OPTIONS = ECR_DISPOSITIONS.map((v) => ({
  value: v,
  label: ECR_DISPOSITION_LABELS[v],
}));

const editsOf = (impacts: readonly EcrImpact[]): Record<string, RowEdit> =>
  Object.fromEntries(
    impacts.map((i) => [
      i.id,
      {
        disposition: i.disposition,
        moveQty: i.moveQty ? String(i.moveQty) : '',
        note: i.note ?? '',
      },
    ]),
  );

/** Why this row's edit cannot be saved, or null. */
function rowError(i: EcrImpact, e: RowEdit): string | null {
  if (e.disposition !== 'move_new') return null;
  const n = Number(e.moveQty);
  if (!e.moveQty.trim() || !Number.isFinite(n) || n <= 0) return 'Enter the Move Qty';
  if (n > i.qtyNotStarted) return `At most ${i.qtyNotStarted} (Qty Not Started)`;
  return null;
}

export function EcrImpactTable({
  ecr,
  canEdit,
}: {
  ecr: Ecr;
  /** Waiting Approval and the user has the right. */
  canEdit: boolean;
}): React.JSX.Element {
  const toast = useToast();
  const saveKey = useSaveKey();
  const save = useSetEcrDispositions(ecr.id, saveKey);
  const [edits, setEdits] = useState<Record<string, RowEdit>>(() => editsOf(ecr.impacts));
  const [dirty, setDirty] = useState(false);
  // A newer copy from the server replaces the rows unless the user is mid-edit.
  useEffect(() => {
    if (!dirty) setEdits(editsOf(ecr.impacts));
  }, [ecr.impacts, ecr.updatedAt, dirty]);

  const put = (id: string, patch: Partial<RowEdit>): void => {
    setDirty(true);
    setEdits((prev) => {
      const cur = prev[id] ?? { disposition: null, moveQty: '', note: '' };
      return { ...prev, [id]: { ...cur, ...patch } };
    });
  };

  const errors = ecr.impacts
    .map((i) => (edits[i.id] ? rowError(i, edits[i.id]!) : null))
    .filter(Boolean);
  const chosen = ecr.impacts.filter((i) => edits[i.id]?.disposition);
  const canSave = canEdit && dirty && errors.length === 0 && chosen.length > 0 && !save.isPending;

  const onSave = (): void => {
    if (!canSave) return;
    save
      .mutateAsync({
        expectedUpdatedAt: ecr.updatedAt,
        impacts: chosen.map((i) => {
          const e = edits[i.id]!;
          return {
            id: i.id,
            disposition: e.disposition!,
            moveQty: e.disposition === 'move_new' ? Number(e.moveQty) : 0,
            note: e.note.trim() || null,
          };
        }),
      })
      .then(() => {
        setDirty(false);
        toast.ok(`${ecr.code}: dispositions saved`);
      })
      .catch((e: unknown) =>
        toast.error(`${ecr.code}: ${e instanceof Error ? e.message : 'Could not save.'}`),
      );
  };

  // Rebuilt each render: the cells read the live edits.
  const columns: DataTableColumn<EcrImpact>[] = [
    {
      id: 'document',
      kind: 'code',
      header: 'Document',
      nowrap: true,
      render: (i) =>
        i.docType === 'job_card' && i.docId ? (
          <Link
            to="/job-cards/$id"
            params={{ id: i.docId }}
            className="td-code"
            onClick={(e) => e.stopPropagation()}
          >
            {i.label}
          </Link>
        ) : (
          <span className="mono fw-700">{i.label}</span>
        ),
    },
    { id: 'qty_done', kind: 'num', header: 'Qty Done', render: (i) => i.qtyDone },
    { id: 'qty_wip', kind: 'num', header: 'Qty WIP', render: (i) => i.qtyWip },
    {
      id: 'qty_not_started',
      kind: 'num',
      header: 'Qty Not Started',
      render: (i) => i.qtyNotStarted,
    },
    { id: 'qty_stock', kind: 'num', header: 'Qty Stock', render: (i) => i.qtyStock },
    { id: 'held_ops', kind: 'num', header: 'Held Ops', render: (i) => i.heldOps },
    {
      id: 'disposition',
      kind: canEdit ? 'control' : 'text',
      header: 'Disposition',
      nowrap: true,
      render: (i) =>
        canEdit ? (
          <Select
            aria-label={`Disposition of ${i.label}`}
            value={edits[i.id]?.disposition ?? ''}
            placeholder="Choose…"
            options={DISPOSITION_OPTIONS}
            onChange={(e) => {
              const v = e.target.value as EcrDisposition | '';
              put(i.id, {
                disposition: v || null,
                ...(v === 'move_new' ? {} : { moveQty: '' }),
              });
            }}
          />
        ) : i.disposition ? (
          ECR_DISPOSITION_LABELS[i.disposition]
        ) : (
          <span className="text3">—</span>
        ),
    },
    {
      id: 'move_qty',
      kind: canEdit ? 'control' : 'num',
      header: 'Move Qty',
      render: (i) => {
        const e = edits[i.id];
        if (!canEdit) return i.moveQty || <span className="text3">—</span>;
        if (e?.disposition !== 'move_new') return <span className="text3">—</span>;
        const err = rowError(i, e);
        return (
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            max={i.qtyNotStarted}
            fieldWidth="xs"
            aria-label={`Move Qty of ${i.label}`}
            aria-invalid={err ? true : undefined}
            title={err ?? undefined}
            state={err ? 'bad' : undefined}
            value={e.moveQty}
            onChange={(ev) => put(i.id, { moveQty: ev.target.value })}
            onWheel={(ev) => ev.currentTarget.blur()}
          />
        );
      },
    },
    {
      id: 'note',
      kind: canEdit ? 'control' : 'text',
      header: 'Disposition Note',
      ellipsis: !canEdit,
      title: (i) => i.note ?? '',
      render: (i) =>
        canEdit ? (
          <Input
            aria-label={`Disposition Note of ${i.label}`}
            fieldWidth="md"
            maxLength={500}
            value={edits[i.id]?.note ?? ''}
            onChange={(ev) => put(i.id, { note: ev.target.value })}
          />
        ) : (
          (i.note ?? <span className="text3">—</span>)
        ),
    },
    {
      id: 'new_doc',
      kind: 'code',
      header: 'New PRO / JC',
      className: 'mono',
      nowrap: true,
      render: (i) =>
        i.newJobCardId ? (
          <Link
            to="/job-cards/$id"
            params={{ id: i.newJobCardId }}
            onClick={(e) => e.stopPropagation()}
          >
            {i.newDocLabel ?? 'Open Job Card'}
          </Link>
        ) : (
          (i.newDocLabel ?? <span className="text3">—</span>)
        ),
    },
  ];

  return (
    <Panel
      title="Impact"
      bodyPadding="none"
      actions={
        canEdit ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!canSave}
            title={
              errors.length > 0
                ? String(errors[0])
                : !dirty
                  ? 'Change a Disposition first'
                  : undefined
            }
            onClick={onSave}
          >
            {save.isPending ? 'Saving…' : 'Save Dispositions'}
          </button>
        ) : null
      }
    >
      <DataTable
        tableKey={TABLE_KEYS.ecrImpacts}
        columns={columns}
        rows={ecr.impacts}
        rowKey={(i) => i.id}
        emptyText={
          ecr.status === 'draft'
            ? 'Submit the ECR to list the work and stock on the old Drawing Rev.'
            : 'Nothing on the old Drawing Rev was found.'
        }
      />
    </Panel>
  );
}
