// Reorder List (ADR-193 phase 5, owner decision Q5): every item Below Reorder
// (Available + On PO under its Reorder Level) with the suggested PR qty and the
// vendor of its last PO. Tick rows, adjust qty / vendor, Raise PRs — one Open PR
// per item, approved as usual. An item that already has an open PR shows it and
// cannot be ticked. Nothing is raised automatically.
import type { ReorderListRow, ReorderPrResult } from '@innovic/shared';
import { createRoute, Link } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { SearchableSelect } from '@/ui/forms';
import { ListHeader } from '@/ui/layout';
import { useVendorsList } from '../../vendors/api';
import { useRaiseReorderPrs, useReorderList } from '../api';

export const reorderListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'reorder-list',
  component: ReorderListPage,
});

interface Draft {
  ticked: boolean;
  qty: string;
  vendorId: string | null;
  vendorLabel: string | undefined;
}

function VendorPicker({
  value,
  label,
  onChange,
}: {
  value: string | null;
  label: string | undefined;
  onChange: (id: string | null, label: string | undefined) => void;
}): React.JSX.Element {
  const [search, setSearch] = useState('');
  const { data, isFetching } = useVendorsList({
    search: search.trim() || undefined,
    isActive: true,
    limit: 30,
    offset: 0,
  });
  const options = useMemo(
    () => (data?.vendors ?? []).map((v) => ({ id: v.id, code: v.code, name: v.name })),
    [data],
  );
  return (
    <SearchableSelect
      value={value}
      valueLabel={label}
      onChange={(id) => onChange(id, options.find((o) => o.id === id)?.code)}
      options={options}
      onSearch={setSearch}
      loading={isFetching}
      placeholder="🔍 Vendor…"
      emptyText="No matching vendor"
    />
  );
}

function ReorderListPage(): React.JSX.Element {
  const { data: eff } = useMyAccess();
  const canRaise = effectiveFormPerms(eff, 'pr_create').entry;
  const { data, isLoading, isError, error } = useReorderList();
  const raise = useRaiseReorderPrs();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<ReorderPrResult | null>(null);

  const draftOf = (r: ReorderListRow): Draft =>
    drafts[r.itemId] ?? {
      ticked: false,
      qty: String(r.suggestedQty),
      vendorId: r.suggestedVendor?.id ?? null,
      vendorLabel: r.suggestedVendor?.code,
    };
  const setDraft = (r: ReorderListRow, patch: Partial<Draft>): void =>
    setDrafts((d) => ({ ...d, [r.itemId]: { ...draftOf(r), ...patch } }));

  const rows = data ?? [];
  const ticked = rows.filter((r) => draftOf(r).ticked);

  const onRaise = (): void => {
    setErr(null);
    setResult(null);
    const lines: Array<{ itemId: string; qty: number; vendorId: string }> = [];
    for (const r of ticked) {
      const d = draftOf(r);
      const q = Number(d.qty);
      if (!Number.isFinite(q) || q <= 0) return setErr(`${r.itemCode}: enter the PR Qty.`);
      if (!d.vendorId) return setErr(`${r.itemCode}: pick the vendor.`);
      lines.push({ itemId: r.itemId, qty: q, vendorId: d.vendorId });
    }
    if (lines.length === 0) return setErr('Tick at least one item.');
    raise.mutate(
      { lines },
      {
        onSuccess: (res) => {
          setResult(res);
          setDrafts({});
        },
        onError: (e) => setErr(e.message || 'Could not raise the PRs.'),
      },
    );
  };

  return (
    <div>
      <ListHeader
        title="Reorder List"
        icon="🔁"
        count={rows.length}
        noun="item below reorder"
        primary={
          canRaise ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={raise.isPending || ticked.length === 0}
              onClick={onRaise}
            >
              {raise.isPending ? 'Raising…' : `Raise PRs (${ticked.length})`}
            </button>
          ) : null
        }
      />
      {result ? (
        <div className="panel" style={{ marginBottom: 10 }}>
          <div className="panel-body" style={{ fontSize: 12 }}>
            {result.created.length > 0 ? (
              <div>
                ✓ Raised:{' '}
                {result.created.map((c, i) => (
                  <span key={c.prId}>
                    {i > 0 ? ', ' : ''}
                    <Link to="/purchase-requests/$id" params={{ id: c.prId }} className="td-code">
                      {c.prCode}
                    </Link>{' '}
                    ({c.itemCode} × {c.qty})
                  </span>
                ))}
              </div>
            ) : null}
            {result.skipped.map((s) => (
              <div key={s.itemCode} style={{ color: 'var(--amber2)' }}>
                Skipped {s.itemCode}: {s.reason}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {err ? (
        <div style={{ color: 'var(--red2)', fontSize: 12, marginBottom: 8 }}>{err}</div>
      ) : null}
      <div className="panel">
        {isLoading ? (
          <div className="panel-body text3" style={{ fontSize: 12 }}>
            <Loader2 size={14} className="inline animate-spin" /> Loading…
          </div>
        ) : isError ? (
          <div className="panel-body empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'Could not load the reorder list.'}
          </div>
        ) : (
          <div className="tbl-wrap">
            <table className="innovic-table tbl-grid">
              <thead>
                <tr>
                  <th></th>
                  <th>Item Code</th>
                  <th>UOM</th>
                  <th className="th-num">Available</th>
                  <th className="th-num">On PO</th>
                  <th className="th-num" title="Listed when Available + On PO is under this level">
                    Reorder Level
                  </th>
                  <th className="th-num">Reorder Qty</th>
                  <th className="th-num">PR Qty</th>
                  <th>Vendor</th>
                  <th>Open PR</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const d = draftOf(r);
                  const blocked = r.openPrs.length > 0;
                  return (
                    <tr key={r.itemId} style={{ opacity: blocked ? 0.6 : 1 }}>
                      <td>
                        <input
                          type="checkbox"
                          disabled={!canRaise || blocked}
                          checked={d.ticked}
                          onChange={(e) => setDraft(r, { ticked: e.target.checked })}
                          aria-label={`Raise PR for ${r.itemCode}`}
                        />
                      </td>
                      <td>
                        <span className="mono fw-700" style={{ color: 'var(--text)' }}>
                          {r.itemCode}
                        </span>
                        {r.itemName ? (
                          <div className="text3" style={{ fontSize: 11 }}>
                            {r.itemName}
                          </div>
                        ) : null}
                      </td>
                      <td className="text3">{r.uom}</td>
                      <td className="mono td-num">{r.availableQty}</td>
                      <td className="mono td-num">{r.onPoQty}</td>
                      <td className="mono td-num">{r.reorderLevel}</td>
                      <td className="mono td-num">{r.reorderQty || '—'}</td>
                      <td className="td-num">
                        <input
                          type="number"
                          min={0}
                          step="any"
                          className="innovic-input mono fw-700"
                          style={{ width: 100, textAlign: 'right' }}
                          disabled={blocked}
                          value={d.qty}
                          onChange={(e) => setDraft(r, { qty: e.target.value })}
                          onWheel={(e) => e.currentTarget.blur()}
                          aria-label={`PR Qty for ${r.itemCode}`}
                        />
                      </td>
                      <td style={{ minWidth: 200 }}>
                        {blocked ? (
                          '—'
                        ) : (
                          <VendorPicker
                            value={d.vendorId}
                            label={d.vendorLabel}
                            onChange={(id, label) =>
                              setDraft(r, { vendorId: id, vendorLabel: label })
                            }
                          />
                        )}
                      </td>
                      <td className="mono" style={{ fontSize: 11 }}>
                        {r.openPrs.map((p) => `${p.code} × ${p.qty}`).join(', ') || '—'}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="empty-state">
                      Nothing is below its Reorder Level.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
