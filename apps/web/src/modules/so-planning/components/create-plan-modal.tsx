// Create Plan modal (PL-4b §4). Triggered by "+ Plan N pcs" on a line card.
// Shows a single qty input; on save creates an in_planning plan and chains
// to the edit modal so the planner can fill in operations + type details.

import type {
  CreatePlanInput,
  PlanningDetailResponse,
  PlanningLine,
} from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useCreatePlan } from '@/modules/plans/api';
import { Modal } from './modal';

interface Props {
  so: PlanningDetailResponse;
  line: PlanningLine;
  onClose: () => void;
  /** Called with the new plan id so the parent can chain into the edit modal. */
  onCreated: (planId: string) => void;
}

export function CreatePlanModal({ so, line, onClose, onCreated }: Props): JSX.Element {
  const remaining = line.remaining;
  const [planQty, setPlanQty] = useState<number>(remaining);
  const [err, setErr] = useState<string | null>(null);
  const createPlan = useCreatePlan();

  const submit = async () => {
    if (planQty <= 0) {
      setErr('Qty must be greater than 0');
      return;
    }
    if (planQty > remaining) {
      setErr(`Cannot exceed remaining: ${remaining} pcs`);
      return;
    }
    setErr(null);
    const input: CreatePlanInput = {
      // code omitted → server assigns the next sequential PLN-NNNN.
      planDate: new Date().toISOString().slice(0, 10),
      planType: 'manufacture',
      // A JW plan links via jwLineId; an SO plan via soLineId. line.soLineId
      // holds whichever line id the detail endpoint returned.
      ...(so.source === 'jw'
        ? { jwLineId: line.soLineId }
        : { soLineId: line.soLineId }),
      soCodeText: so.soCode,
      lineNo: line.lineNo,
      itemId: line.itemId ?? null,
      itemCodeText: line.itemCode ?? '',
      itemNameText: line.itemName ?? '',
      orderQty: line.orderQty,
      planQty,
    };
    try {
      const created = await createPlan.mutateAsync(input);
      onCreated(created.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create plan');
    }
  };

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose}>
        Cancel
      </button>
      <button
        type="button"
        className="btn btn-primary"
        onClick={submit}
        disabled={createPlan.isPending}
      >
        {createPlan.isPending ? (
          <>
            <Loader2 className="inline-block animate-spin" style={{ width: 14, height: 14 }} /> …
          </>
        ) : (
          // Legacy createPlan calls showModal(title, body, onSave, 'Create Plan'),
          // but showModal (L28014) takes only 3 params — the 4th arg is dead code
          // and the footer is the hard-coded Cancel / Save pair (L28026-27).
          'Save'
        )}
      </button>
    </>
  );

  return (
    <Modal
      title={`Create Plan — ${line.itemCode ?? line.itemName ?? `Line ${line.lineNo}`}`}
      onClose={onClose}
      footer={footer}
    >
      <div
        style={{
          background: 'var(--bg3)',
          padding: 12,
          borderRadius: 8,
          border: '1px solid var(--border)',
          marginBottom: 14,
        }}
      >
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <span style={{ fontSize: 10, color: 'var(--text3)' }}>SO/JW</span>
            <br />
            <b className="mono">
              {so.soCode} L{line.lineNo}
            </b>
          </div>
          <div>
            <span style={{ fontSize: 10, color: 'var(--text3)' }}>ITEM</span>
            <br />
            <b style={{ color: 'var(--purple)' }}>{line.itemCode ?? '—'}</b>
          </div>
          <div>
            <span style={{ fontSize: 10, color: 'var(--text3)' }}>SO QTY</span>
            <br />
            <b style={{ fontSize: 18 }}>{line.orderQty}</b>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
          <div
            style={{
              textAlign: 'center',
              padding: '8px 16px',
              background: 'var(--bg)',
              borderRadius: 6,
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ fontSize: 10, color: 'var(--text3)' }}>ALREADY PLANNED</div>
            <div className="mono fw-700" style={{ fontSize: 20, color: 'var(--cyan)' }}>
              {line.totalPlanned}
            </div>
          </div>
          <div
            style={{
              textAlign: 'center',
              padding: '8px 16px',
              background: 'var(--bg)',
              borderRadius: 6,
              border: '1px solid rgba(34,197,94,0.3)',
            }}
          >
            <div style={{ fontSize: 10, color: 'var(--text3)' }}>REMAINING</div>
            <div className="mono fw-700" style={{ fontSize: 20, color: 'var(--green)' }}>
              {remaining}
            </div>
          </div>
        </div>
      </div>

      <div className="form-grp">
        <label
          className="form-label"
          style={{ color: 'var(--cyan)', fontWeight: 700, fontSize: 14 }}
        >
          Plan Qty ★
        </label>
        <input
          type="number"
          min={1}
          max={remaining}
          value={planQty}
          onChange={(e) => setPlanQty(Number(e.target.value))}
          style={{
            fontSize: 22,
            fontWeight: 800,
            textAlign: 'center',
            border: '2px solid var(--cyan)',
            color: 'var(--cyan)',
            padding: 10,
            width: '100%',
          }}
        />
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
          Max: {remaining} pcs (SO: {line.orderQty} − Already Planned: {line.totalPlanned})
        </div>
      </div>

      {err ? (
        <div
          style={{
            marginTop: 12,
            padding: 8,
            borderRadius: 4,
            background: 'rgba(239,68,68,0.1)',
            color: 'var(--red)',
            fontSize: 12,
          }}
        >
          {err}
        </div>
      ) : null}
    </Modal>
  );
}
