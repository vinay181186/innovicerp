// Item Issue — the slip's lines: one row per item, Issue Qty typed per row.
// Rows come from the material table ("Fill To Issue") or the item picker.
import { Icon } from '@/ui/core';
import { useMemo, useState } from 'react';
import { SearchableSelect, Select } from '@/ui/forms';
import { useItemsList } from '../../items/api';
import { useItemRevStock } from '../../store-inventory/api';

export interface DraftIssueLine {
  itemId: string;
  itemCode: string;
  itemName: string | null;
  uom: string | null;
  qtyText: string;
  /** Hint beside the qty box, e.g. "To Issue 12 · Available 30". */
  hint?: string | undefined;
  /** ADR-292 — the Drawing Rev bucket to issue from. undefined = not chosen
   *  (the server takes the only bucket that fits the Job Card's Rev, else asks);
   *  null = the blank "no Rev" bucket. */
  itemRevisionId?: string | null | undefined;
}

const NO_REV = '__no_rev__';

/** ADR-292 — the "Drawing Rev" choice of one line: shown only for an item that
 *  holds stock under a Drawing Rev (a make item with Rev buckets). */
function DrawingRevCell({
  line,
  onPick,
}: {
  line: DraftIssueLine;
  onPick: (itemRevisionId: string | null | undefined) => void;
}): React.JSX.Element {
  const q = useItemRevStock(line.itemId);
  const buckets = q.data ?? [];
  if (q.isLoading) return <span className="text3">…</span>;
  if (q.isError)
    return (
      <span className="text3" title={q.error.message}>
        —
      </span>
    );
  if (!buckets.some((b) => b.itemRevisionId)) return <span className="text3">—</span>;
  const value = line.itemRevisionId === undefined ? '' : (line.itemRevisionId ?? NO_REV);
  return (
    <Select
      aria-label={`Drawing Rev for ${line.itemCode}`}
      placeholder="Choose Drawing Rev"
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        onPick(v === '' ? undefined : v === NO_REV ? null : v);
      }}
      options={buckets.map((b) => ({
        value: b.itemRevisionId ?? NO_REV,
        label: `${b.itemRevisionId ? b.label : `${line.itemCode} · no Rev`} · free ${b.freeQty}`,
      }))}
    />
  );
}

export function IssueLinesEditor({
  lines,
  onChange,
}: {
  lines: DraftIssueLine[];
  onChange: (next: DraftIssueLine[]) => void;
}): React.JSX.Element {
  const [search, setSearch] = useState('');
  const [pickerKey, setPickerKey] = useState(0);
  const { data, isFetching } = useItemsList({
    search: search.trim() || undefined,
    limit: 50,
    offset: 0,
  });
  const options = useMemo(
    () => (data?.items ?? []).map((it) => ({ id: it.id, code: it.code, name: it.name })),
    [data],
  );

  const add = (id: string | null): void => {
    if (!id) return;
    const it = data?.items.find((x) => x.id === id);
    if (!it || lines.some((l) => l.itemId === id)) {
      setPickerKey((k) => k + 1);
      return;
    }
    onChange([
      ...lines,
      { itemId: it.id, itemCode: it.code, itemName: it.name, uom: it.uom ?? null, qtyText: '' },
    ]);
    setPickerKey((k) => k + 1);
  };
  const setQty = (i: number, qtyText: string): void =>
    onChange(lines.map((l, j) => (j === i ? { ...l, qtyText } : l)));
  const setRev = (i: number, itemRevisionId: string | null | undefined): void =>
    onChange(lines.map((l, j) => (j === i ? { ...l, itemRevisionId } : l)));
  const remove = (i: number): void => onChange(lines.filter((_, j) => j !== i));

  return (
    <div>
      <div className="tbl-wrap">
        <table className="innovic-table tbl-grid">
          <thead>
            <tr>
              <th>Item Code</th>
              <th>Item Name</th>
              <th className="th-ctr">UOM</th>
              <th className="th-ctr">Drawing Rev</th>
              <th className="th-num">Issue Qty</th>
              <th className="th-ctr"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.itemId}>
                <td>
                  <span className="td-code mono fw-700" style={{ color: 'var(--text)' }}>
                    {l.itemCode}
                  </span>
                </td>
                <td>{l.itemName || '—'}</td>
                <td className="td-ctr text3">{l.uom || '—'}</td>
                <td className="td-ctr">
                  <DrawingRevCell line={l} onPick={(rev) => setRev(i, rev)} />
                </td>
                <td className="td-num">
                  <input
                    type="number"
                    min={0}
                    step="any"
                    className="innovic-input mono fw-700"
                    style={{ width: 110 }}
                    value={l.qtyText}
                    onChange={(e) => setQty(i, e.target.value)}
                    onWheel={(e) => e.currentTarget.blur()}
                    aria-label={`Issue Qty for ${l.itemCode}`}
                  />
                  {l.hint ? (
                    <div
                      className="text3"
                      style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--sp-0)' }}
                    >
                      {l.hint}
                    </div>
                  ) : null}
                </td>
                <td className="td-ctr">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm btn-icon"
                    onClick={() => remove(i)}
                    title="Remove this line"
                  >
                    <Icon name="trash-2" size={13} />
                  </button>
                </td>
              </tr>
            ))}
            {lines.length === 0 ? (
              <tr>
                <td colSpan={6} className="empty-state">
                  No items yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 'var(--sp-2)' }}>
        <SearchableSelect
          key={pickerKey}
          id="si-add-item"
          value={null}
          onChange={add}
          options={options}
          onSearch={setSearch}
          loading={isFetching}
          placeholder="+ Add item — type item code or name…"
          emptyText="No matching item"
        />
      </div>
    </div>
  );
}

/** Lines → API lines; returns an error message instead when a qty is bad. */
export function toIssueLines(
  lines: DraftIssueLine[],
):
  | { ok: true; lines: Array<{ itemId: string; qty: number; itemRevisionId?: string | null }> }
  | { ok: false; error: string } {
  if (lines.length === 0) return { ok: false, error: 'Add at least one item.' };
  const out: Array<{ itemId: string; qty: number; itemRevisionId?: string | null }> = [];
  for (const l of lines) {
    const q = Number(l.qtyText);
    if (!l.qtyText.trim() || !Number.isFinite(q) || q <= 0) {
      return { ok: false, error: `Enter the Issue Qty for ${l.itemCode} (more than 0).` };
    }
    if (Math.round(q * 1000) / 1000 !== q) {
      return { ok: false, error: `${l.itemCode}: Issue Qty allows at most 3 decimals.` };
    }
    out.push({
      itemId: l.itemId,
      qty: q,
      ...(l.itemRevisionId !== undefined ? { itemRevisionId: l.itemRevisionId } : {}),
    });
  }
  return { ok: true, lines: out };
}
