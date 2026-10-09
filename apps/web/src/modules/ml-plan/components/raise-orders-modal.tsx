// Raise Orders (ADR-225 phase 4): every Multi-Level Plan row with To Raise > 0,
// ticked by default. What each row raises is the server's `raises` — Plan, PR
// or a full-outsource Plan (needs Vendor + Process). One POST for the ticked rows; the server
// checks To Raise under the plan's row lock and raises all or none, so the
// checks here only save the user a round trip — the server is the rule.

import {
  BOM_LINE_TYPE_LABEL,
  type MlPlanDetail,
  type MlPlanNode,
  type RaiseMlPlanOrderLine,
} from '@innovic/shared';
import { useMemo, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { useSaveKey } from '@/lib/use-save-key';
import { useVendorsList } from '@/modules/vendors/api';
import { Button } from '@/ui/core';
import { DataTable, type DataTableColumn } from '@/ui/data';
import { Banner, Modal } from '@/ui/feedback';
import { useRaiseMlPlanOrders } from '../api';

const dash = <span className="text3">—</span>;

/** What a row becomes — `raises` is decided by the server. */
const RAISES_LABEL: Record<MlPlanNode['raises'], string> = {
  plan: 'Plan',
  pr: 'PR',
  outsource_plan: 'Outsource Plan',
};

interface RowState {
  checked: boolean;
  qtyText: string;
  vendorId: string | null;
  vendorLabel: string;
  process: string;
}

/** Quantities arrive as numeric strings; drop trailing zeros only. */
const qtyText = (v: string): string => String(Number(v));
/** Thousandths, so 0.1 + 0.2 style float noise never decides a cap. */
const milli = (v: number): number => Math.round(v * 1000);

function rowError(n: MlPlanNode, s: RowState): string | null {
  const code = n.itemCode ?? 'Row';
  const toRaise = Number(n.toRaiseQty);
  const raw = s.qtyText.trim();
  const q = Number(raw);
  if (raw === '' || !Number.isFinite(q) || q <= 0) return `${code}: Qty must be more than 0.`;
  if (n.raises !== 'pr') {
    if (!Number.isInteger(q)) return `${code}: Qty must be a whole number.`;
  } else if (!/^\d+(\.\d{1,3})?$/.test(raw)) {
    return `${code}: Qty allows up to 3 decimals.`;
  }
  if (milli(q) > milli(toRaise)) {
    return `${code}: Qty cannot be more than To Raise (${qtyText(n.toRaiseQty)}).`;
  }
  if (n.raises === 'outsource_plan') {
    if (!s.vendorId) return `${code}: Vendor is required.`;
    if (!s.process.trim()) return `${code}: Process is required.`;
  }
  return null;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

interface Props {
  detail: MlPlanDetail;
  onClose: () => void;
}

export function RaiseOrdersModal({ detail, onClose }: Props): React.JSX.Element {
  const saveKey = useSaveKey();
  const raise = useRaiseMlPlanOrders(detail.id, saveKey);
  const [error, setError] = useState<string | null>(null);
  const [requiredDate, setRequiredDate] = useState('');

  const rows = useMemo(
    () => [...detail.nodes].filter((n) => Number(n.toRaiseQty) > 0).sort((a, b) => a.seq - b.seq),
    [detail.nodes],
  );

  const [state, setState] = useState<Map<string, RowState>>(
    () =>
      new Map(
        rows.map((n) => [
          n.id,
          {
            checked: true,
            qtyText: qtyText(n.toRaiseQty),
            vendorId: null,
            vendorLabel: '',
            process: '',
          },
        ]),
      ),
  );
  const update = (id: string, patch: Partial<RowState>): void => {
    setState((prev) => {
      const cur = prev.get(id);
      if (!cur) return prev;
      const next = new Map(prev);
      next.set(id, { ...cur, ...patch });
      return next;
    });
  };

  // Vendors for the Outsource rows — server-side search, one shared term (only
  // one picker is open at a time), active vendors only. Same as the BOM
  // Planning modal.
  const [vendorSearch, setVendorSearch] = useState('');
  const { data: vendorPage, isFetching: vendorsFetching } = useVendorsList({
    ...(vendorSearch.trim() ? { search: vendorSearch.trim() } : {}),
    isActive: true,
    limit: 50,
    offset: 0,
  });
  const vendors = useMemo(() => vendorPage?.vendors ?? [], [vendorPage]);
  const vendorOptions = useMemo(
    () => vendors.map((v) => ({ id: v.id, code: v.code, name: v.name })),
    [vendors],
  );

  const ticked = rows.filter((n) => state.get(n.id)?.checked);
  const prCount = ticked.filter((n) => n.raises === 'pr').length;
  const planCount = ticked.length - prCount;
  const allTicked = rows.length > 0 && ticked.length === rows.length;

  const onSubmit = (): void => {
    if (raise.isPending) return;
    setError(null);
    if (ticked.length === 0) {
      setError('Pick at least one row.');
      return;
    }
    const lines: RaiseMlPlanOrderLine[] = [];
    for (const n of ticked) {
      const s = state.get(n.id);
      if (!s) continue;
      const err = rowError(n, s);
      if (err) {
        setError(err);
        return;
      }
      const isOutsource = n.raises === 'outsource_plan';
      lines.push({
        nodeId: n.id,
        qty: Number(s.qtyText.trim()),
        ...(isOutsource ? { vendorId: s.vendorId, process: s.process.trim() } : {}),
        requiredDate: requiredDate || null,
      });
    }
    raise.mutate(
      { lines, expectedUpdatedAt: detail.updatedAt },
      {
        onSuccess: () => onClose(),
        onError: (e) => setError(e.message),
      },
    );
  };

  const columns: DataTableColumn<MlPlanNode>[] = [
    {
      id: 'tick',
      header: (
        <input
          type="checkbox"
          aria-label="Tick all"
          checked={allTicked}
          onChange={(e) => {
            const on = e.target.checked;
            setState((prev) => {
              const next = new Map(prev);
              for (const [id, s] of prev) next.set(id, { ...s, checked: on });
              return next;
            });
          }}
        />
      ),
      kind: 'control',
      render: (n) => (
        <input
          type="checkbox"
          aria-label={`Raise ${n.itemCode ?? ''}`}
          checked={state.get(n.id)?.checked ?? false}
          onChange={(e) => update(n.id, { checked: e.target.checked })}
        />
      ),
    },
    { header: 'Level', align: 'right', className: 'mono', render: (n) => n.depth },
    {
      header: 'Item Code',
      align: 'left',
      nowrap: true,
      render: (n) =>
        n.itemCode ? (
          <span className="mono fw-700" style={{ color: 'var(--text)' }}>
            {n.itemCode}
          </span>
        ) : (
          dash
        ),
    },
    {
      header: 'Item Name',
      align: 'left',
      ellipsis: true,
      render: (n) => n.itemName ?? dash,
      title: (n) => n.itemName ?? '',
    },
    {
      header: 'Line Type',
      nowrap: true,
      render: (n) => (n.bomType ? BOM_LINE_TYPE_LABEL[n.bomType] : dash),
    },
    { header: 'Raises', nowrap: true, render: (n) => RAISES_LABEL[n.raises] },
    {
      header: 'To Raise',
      align: 'right',
      nowrap: true,
      className: 'mono fw-700',
      render: (n) => qtyText(n.toRaiseQty),
    },
    {
      header: 'Qty',
      align: 'right',
      kind: 'control',
      render: (n) => {
        const s = state.get(n.id);
        const whole = n.raises !== 'pr';
        return (
          <input
            type="number"
            className="innovic-input"
            aria-label={`Qty ${n.itemCode ?? ''}`}
            style={{ width: '10ch' }}
            min={whole ? 1 : 0.001}
            step={whole ? 1 : 0.001}
            max={Number(n.toRaiseQty)}
            disabled={!s?.checked}
            value={s?.qtyText ?? ''}
            onChange={(e) => update(n.id, { qtyText: e.target.value })}
          />
        );
      },
    },
    {
      header: 'Vendor',
      kind: 'control',
      render: (n) => {
        if (n.raises !== 'outsource_plan') return dash;
        const s = state.get(n.id);
        return (
          <div style={{ minWidth: 240 }}>
            <SearchableSelect
              id={`mlplan-raise-vendor-${n.id}`}
              ariaLabel={`Vendor ${n.itemCode ?? ''}`}
              value={s?.vendorId ?? null}
              disabled={!s?.checked}
              onChange={(vid) => {
                const v = vendors.find((x) => x.id === vid);
                update(n.id, {
                  vendorId: vid,
                  vendorLabel: v ? `${v.code} — ${v.name}` : '',
                });
              }}
              onSearch={setVendorSearch}
              loading={vendorsFetching}
              options={vendorOptions}
              placeholder="Search vendor code or name…"
              emptyText="No matching vendor"
              {...(s?.vendorLabel ? { valueLabel: s.vendorLabel } : {})}
            />
          </div>
        );
      },
    },
    {
      header: 'Process',
      kind: 'control',
      render: (n) => {
        if (n.raises !== 'outsource_plan') return dash;
        const s = state.get(n.id);
        return (
          <input
            className="innovic-input"
            aria-label={`Process ${n.itemCode ?? ''}`}
            style={{ width: '20ch' }}
            maxLength={200}
            disabled={!s?.checked}
            value={s?.process ?? ''}
            onChange={(e) => update(n.id, { process: e.target.value })}
          />
        );
      },
    },
  ];

  const footer = (
    <>
      <span className="text3" style={{ marginRight: 'auto', fontSize: 'var(--fs-sm)' }}>
        {plural(ticked.length, 'row', 'rows')} → {plural(planCount, 'Plan', 'Plans')},{' '}
        {plural(prCount, 'PR', 'PRs')}
      </span>
      <Button variant="ghost" size="sm" onClick={onClose} disabled={raise.isPending}>
        Close
      </Button>
      <Button
        variant="primary"
        size="sm"
        onClick={onSubmit}
        loading={raise.isPending}
        disabled={ticked.length === 0}
      >
        {raise.isPending ? 'Raising…' : 'Raise Orders'}
      </Button>
    </>
  );

  return (
    <Modal
      open
      title={`Raise Orders — ${detail.code}`}
      size="lg"
      onClose={onClose}
      closeOnOverlayClick={false}
      closeOnEscape={!raise.isPending}
      footer={footer}
      bodyStyle={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}
    >
      <div className="form-grp" style={{ maxWidth: '18ch' }}>
        <label className="form-label" htmlFor="mlplan-raise-date">
          Required Date
        </label>
        <input
          id="mlplan-raise-date"
          type="date"
          className="innovic-input"
          value={requiredDate}
          onChange={(e) => setRequiredDate(e.target.value)}
        />
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(n) => n.id}
        density="compact"
        editable
        autoWidth
        emptyText="Nothing to raise."
      />
      {error ? (
        <Banner tone="error" role="alert" flush onDismiss={() => setError(null)}>
          {error}
        </Banner>
      ) : null}
    </Modal>
  );
}
