// Item Issue — the slip's lines: one row per item, Issue Qty typed per row.
// Rows come from the material table ("Fill To Issue") or the item picker.
import { Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { SearchableSelect } from '@/ui/forms';
import { useItemsList } from '../../items/api';

export interface DraftIssueLine {
  itemId: string;
  itemCode: string;
  itemName: string | null;
  uom: string | null;
  qtyText: string;
  /** Hint beside the qty box, e.g. "To Issue 12 · Available 30". */
  hint?: string | undefined;
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
  const remove = (i: number): void => onChange(lines.filter((_, j) => j !== i));

  return (
    <div>
      <div className="tbl-wrap">
        <table className="innovic-table tbl-grid">
          <thead>
            <tr>
              <th>Item Code</th>
              <th>Item Name</th>
              <th>UOM</th>
              <th className="th-num">Issue Qty</th>
              <th></th>
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
                <td className="text3">{l.uom || '—'}</td>
                <td className="td-num">
                  <input
                    type="number"
                    min={0}
                    step="any"
                    className="innovic-input mono fw-700"
                    style={{ width: 110, textAlign: 'right' }}
                    value={l.qtyText}
                    onChange={(e) => setQty(i, e.target.value)}
                    onWheel={(e) => e.currentTarget.blur()}
                    aria-label={`Issue Qty for ${l.itemCode}`}
                  />
                  {l.hint ? (
                    <div className="text3" style={{ fontSize: 10, marginTop: 2 }}>
                      {l.hint}
                    </div>
                  ) : null}
                </td>
                <td>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm btn-icon"
                    onClick={() => remove(i)}
                    title="Remove this line"
                  >
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
            {lines.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty-state">
                  No items yet — fill from the material list above or add an item below.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 8 }}>
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
): { ok: true; lines: Array<{ itemId: string; qty: number }> } | { ok: false; error: string } {
  if (lines.length === 0) return { ok: false, error: 'Add at least one item.' };
  const out: Array<{ itemId: string; qty: number }> = [];
  for (const l of lines) {
    const q = Number(l.qtyText);
    if (!l.qtyText.trim() || !Number.isFinite(q) || q <= 0) {
      return { ok: false, error: `Enter the Issue Qty for ${l.itemCode} (more than 0).` };
    }
    if (Math.round(q * 1000) / 1000 !== q) {
      return { ok: false, error: `${l.itemCode}: Issue Qty allows at most 3 decimals.` };
    }
    out.push({ itemId: l.itemId, qty: q });
  }
  return { ok: true, lines: out };
}
