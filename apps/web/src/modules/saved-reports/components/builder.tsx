// Drag-and-drop ad-hoc report builder (T-041b).
//
// Mirrors legacy `renderReportBuilder` (legacy HTML L17526-17606):
//   - Data Source picker chips at the top (L17560)
//   - Available Fields list on the left, draggable (L17565)
//   - Three drop zones on the right: Excel Columns / Filters / Group By (L17574-94)
//   - Actions: Generate Excel / Preview / Clear All (L17597-17602)
//
// Uses native HTML5 drag & drop (matches legacy semantics, no extra deps).
// Drag payload encoding:
//   "FIELD:<key>"   — drag a field from the Available list
//   "COL:<index>"   — drag a column chip to reorder

import type {
  AdHocFilter,
  AdHocSpec,
  AggFunction,
  FilterOp,
  RunAdHocResponse,
  SourceDescriptor,
  SourceFieldDescriptor,
} from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useMemo, useState, type CSSProperties, type DragEvent } from 'react';
import { ResultTable } from './result-table';

interface Props {
  sources: SourceDescriptor[];
  initial: BuilderInitial;
  onSave: (input: SaveInput) => void;
  onPreview: (spec: AdHocSpec) => void;
  preview: RunAdHocResponse | undefined;
  previewLoading: boolean;
  previewError?: string | undefined;
  /** Optional Excel export of the current spec (server runs + serialises). */
  onExcel?: (spec: AdHocSpec) => void;
  excelLoading?: boolean;
  saving: boolean;
  saveError?: string | undefined;
  saveLabel: string;
}

export interface BuilderInitial {
  name: string;
  description: string;
  isShared: boolean;
  spec: AdHocSpec | null;
}

export interface SaveInput {
  name: string;
  description: string;
  isShared: boolean;
  spec: AdHocSpec;
}

// Mirrors legacy `_rbDC` (L17510): number → green, date → amber, else purple.
// Legacy's hexes come from its own :root; we consume the same token names,
// which tokens.css remaps for the light theme (ISSUE-067).
const TYPE_DOT: Record<string, string> = {
  number: 'var(--green)',
  date: 'var(--amber)',
  datetime: 'var(--amber)',
  text: 'var(--purple)',
};

function dotColor(type: string): string {
  return TYPE_DOT[type] ?? 'var(--purple)';
}

// Legacy's zone boxes / chips are inline-styled (L17530-17594) — no classes
// exist for them in either stylesheet, so they are mirrored inline against
// our tokens rather than approximated with an invented class.
const PANEL_TITLE: CSSProperties = { fontSize: 14, fontWeight: 700, marginBottom: 10 };
const ZONE_TITLE: CSSProperties = { fontSize: 13, fontWeight: 700, marginBottom: 6 };
const ZONE_HINT: CSSProperties = { fontSize: 11, color: 'var(--text3)', fontWeight: 400 };
const CHIP: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '5px 12px',
  borderRadius: 16,
  fontSize: 12,
  fontWeight: 500,
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
};
const CHIP_X: CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  color: 'var(--text3)',
  cursor: 'pointer',
  fontSize: 14,
  lineHeight: 1,
};
const COMPACT_CONTROL: CSSProperties = {
  padding: '5px 8px',
  fontSize: 12,
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text)',
};

function dot(type: string): JSX.Element {
  return <span style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor(type) }} />;
}

const ALL_OPS: FilterOp[] = ['equals', 'notEquals', 'contains', 'gt', 'lt', 'after', 'before'];
const TEXT_OPS: FilterOp[] = ['equals', 'notEquals', 'contains'];
const NUMBER_OPS: FilterOp[] = ['equals', 'notEquals', 'gt', 'lt'];
const DATE_OPS: FilterOp[] = ['equals', 'after', 'before'];

const OP_LABELS: Record<FilterOp, string> = {
  equals: 'equals',
  notEquals: 'not equals',
  contains: 'contains',
  gt: 'greater than',
  lt: 'less than',
  after: 'after',
  before: 'before',
};

const AGG_OPTIONS: AggFunction[] = ['SUM', 'COUNT', 'AVG', 'MIN', 'MAX'];

function opsForType(type: string): FilterOp[] {
  if (type === 'number') return NUMBER_OPS;
  if (type === 'date' || type === 'datetime') return DATE_OPS;
  return TEXT_OPS;
}

export function Builder(props: Props): JSX.Element {
  const {
    sources,
    initial,
    onSave,
    onPreview,
    preview,
    previewLoading,
    previewError,
    onExcel,
    excelLoading,
    saving,
    saveError,
    saveLabel,
  } = props;

  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [isShared, setIsShared] = useState(initial.isShared);

  const [sourceKey, setSourceKey] = useState(
    initial.spec?.sourceKey ?? sources[0]?.sourceKey ?? '',
  );
  const [columns, setColumns] = useState<string[]>(initial.spec?.columns ?? []);
  const [filters, setFilters] = useState<AdHocFilter[]>(initial.spec?.filters ?? []);
  const [groupBy, setGroupBy] = useState<string | null>(initial.spec?.groupBy ?? null);
  const [sumCol, setSumCol] = useState<string | null>(initial.spec?.sumCol ?? null);
  const [sumFn, setSumFn] = useState<AggFunction>(initial.spec?.sumFn ?? 'SUM');

  const source = useMemo(
    () => sources.find((s) => s.sourceKey === sourceKey),
    [sources, sourceKey],
  );
  const fieldMap = useMemo(() => {
    const m = new Map<string, SourceFieldDescriptor>();
    for (const f of source?.fields ?? []) m.set(f.key, f);
    return m;
  }, [source]);

  const numericFields = useMemo(
    () => source?.fields.filter((f) => f.type === 'number') ?? [],
    [source],
  );

  const buildSpec = (): AdHocSpec => ({
    sourceKey,
    columns,
    filters,
    groupBy,
    sumCol,
    sumFn,
    sort: [],
  });

  const onChangeSource = (next: string) => {
    setSourceKey(next);
    const nextSource = sources.find((s) => s.sourceKey === next);
    setColumns(nextSource?.fields.slice(0, 6).map((f) => f.key) ?? []);
    setFilters([]);
    setGroupBy(null);
    setSumCol(null);
    setSumFn('SUM');
  };

  const handleDragStartField = (e: DragEvent, key: string) => {
    e.dataTransfer.setData('text/plain', `FIELD:${key}`);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragStartColumn = (e: DragEvent, index: number) => {
    e.dataTransfer.setData('text/plain', `COL:${index}`);
    e.dataTransfer.effectAllowed = 'move';
  };

  const allowDrop = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDropColumns = (e: DragEvent) => {
    e.preventDefault();
    const data = e.dataTransfer.getData('text/plain');
    if (data.startsWith('FIELD:')) {
      const key = data.slice('FIELD:'.length);
      if (!fieldMap.has(key)) return;
      setColumns((prev) => (prev.includes(key) ? prev : [...prev, key]));
    }
  };

  const handleDropFilters = (e: DragEvent) => {
    e.preventDefault();
    const data = e.dataTransfer.getData('text/plain');
    if (data.startsWith('FIELD:')) {
      const key = data.slice('FIELD:'.length);
      const f = fieldMap.get(key);
      if (!f || !f.filterable) return;
      setFilters((prev) =>
        prev.some((x) => x.field === key)
          ? prev
          : [...prev, { field: key, op: opsForType(f.type)[0]!, value: '' }],
      );
    }
  };

  const handleDropGroup = (e: DragEvent) => {
    e.preventDefault();
    const data = e.dataTransfer.getData('text/plain');
    if (data.startsWith('FIELD:')) {
      const key = data.slice('FIELD:'.length);
      const f = fieldMap.get(key);
      if (!f || !f.groupable) return;
      setGroupBy(key);
      if (!sumCol && numericFields.length > 0) {
        setSumCol(numericFields[0]!.key);
      }
    }
  };

  const removeColumn = (key: string) => setColumns((prev) => prev.filter((k) => k !== key));
  const removeFilter = (key: string) => setFilters((prev) => prev.filter((f) => f.field !== key));

  // Legacy L17576: "All" fills the Columns zone with every field of the source.
  const onAllColumns = () => setColumns((source?.fields ?? []).map((f) => f.key));

  const onClearAll = () => {
    setColumns([]);
    setFilters([]);
    setGroupBy(null);
    setSumCol(null);
  };

  const usedKeys = new Set<string>([
    ...columns,
    ...filters.map((f) => f.field),
    ...(groupBy ? [groupBy] : []),
  ]);

  const onPreviewClick = () => onPreview(buildSpec());

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (columns.length === 0) return;
    onSave({ name: name.trim(), description, isShared, spec: buildSpec() });
  };

  return (
    <form onSubmit={onSubmit}>
      {/* Report Details — NO legacy counterpart: legacy `_rbSaveTemplate` (L17673)
          collects the name with a prompt() and has no description / shared concept.
          Kept (and not replaced by a prompt) — it is how saving works here. */}
      <div className="panel">
        <div className="panel-body">
          <div style={PANEL_TITLE}>Report Details</div>
          <div className="form-grid">
            <div className="form-grp">
              <label className="form-label" htmlFor="rb-name">
                Name<span className="req">★</span>
              </label>
              <input
                id="rb-name"
                className="innovic-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Open SOs by client"
                required
              />
            </div>
            <div className="form-grp">
              <label className="form-label" htmlFor="rb-desc">
                Description
              </label>
              <input
                id="rb-desc"
                className="innovic-input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="optional"
              />
            </div>
            <div className="form-grp form-full">
              <label className="form-label" htmlFor="rb-shared">
                Shared
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <input
                  id="rb-shared"
                  type="checkbox"
                  checked={isShared}
                  onChange={(e) => setIsShared(e.target.checked)}
                />
                <span style={{ color: 'var(--text2)' }}>
                  Visible to everyone in the company; only you (or admin/manager) can edit.
                </span>
              </label>
            </div>
          </div>
          {saveError ? <div className="form-error">{saveError}</div> : null}
        </div>
      </div>

      {/* Data Source — legacy L17560 */}
      <div className="panel">
        <div className="panel-body">
          <div style={PANEL_TITLE}>Data Source</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {sources.map((s) => {
              const sel = s.sourceKey === sourceKey;
              return (
                <button
                  key={s.sourceKey}
                  type="button"
                  onClick={() => onChangeSource(s.sourceKey)}
                  style={{
                    display: 'inline-block',
                    padding: '5px 14px',
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: sel ? 700 : 400,
                    cursor: 'pointer',
                    border: `1px solid ${sel ? 'var(--blue)' : 'var(--border)'}`,
                    background: sel ? 'var(--blue3)' : 'var(--bg4)',
                    color: sel ? 'var(--blue)' : 'var(--text2)',
                  }}
                >
                  {s.label}
                  <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text3)' }}>
                    {s.group}
                  </span>
                </button>
              );
            })}
          </div>
          {source ? (
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text3)' }}>
              {source.description}
            </div>
          ) : null}
        </div>
      </div>

      {/* Legacy L17561 — no source selected: nothing below the picker renders. */}
      {!source ? <div className="empty-state">Select a data source to start.</div> : null}

      {source ? (
        <>
          {/* Builder grid — legacy L17563 */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '200px minmax(0,1fr)',
              gap: 12,
              marginBottom: 12,
            }}
          >
            {/* Available Fields — legacy L17565 */}
            <div className="panel" style={{ marginBottom: 0 }}>
              <div className="panel-body">
                <div style={ZONE_TITLE}>Available Fields</div>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 8 }}>
                  Drag to right zones →
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {source.fields.map((f) => {
                    const used = usedKeys.has(f.key);
                    return (
                      <div
                        key={f.key}
                        draggable={!used}
                        onDragStart={(e) => handleDragStartField(e, f.key)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '5px 10px',
                          borderRadius: 16,
                          fontSize: 12,
                          background: 'var(--bg)',
                          border: '1px solid var(--border)',
                          color: 'var(--text)',
                          ...(used
                            ? { opacity: 0.35, textDecoration: 'line-through' }
                            : { cursor: 'grab' }),
                        }}
                      >
                        {dot(f.type)}
                        {f.label}
                      </div>
                    );
                  })}
                </div>
                <div
                  style={{
                    marginTop: 8,
                    fontSize: 10,
                    color: 'var(--text3)',
                    display: 'flex',
                    gap: 6,
                  }}
                >
                  <span>
                    <span style={{ color: dotColor('text') }}>●</span> text
                  </span>
                  <span>
                    <span style={{ color: dotColor('number') }}>●</span> number
                  </span>
                  <span>
                    <span style={{ color: dotColor('date') }}>●</span> date
                  </span>
                </div>
              </div>
            </div>

            {/* Drop zones — legacy L17572 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Excel Columns — legacy L17574 */}
              <div className="panel" style={{ marginBottom: 0 }}>
                <div className="panel-body">
                  <div
                    style={{
                      ...ZONE_TITLE,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span>
                      Excel Columns <span style={ZONE_HINT}>(order = Excel order)</span>
                    </span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: 10 }}
                        onClick={onAllColumns}
                      >
                        All
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: 10 }}
                        onClick={() => setColumns([])}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  <div
                    onDragOver={allowDrop}
                    onDrop={handleDropColumns}
                    style={{
                      minHeight: 44,
                      border: '1.5px dashed var(--cyan)',
                      borderRadius: 8,
                      padding: 8,
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 6,
                    }}
                  >
                    {columns.length === 0 ? (
                      <span style={{ color: 'var(--text3)', fontSize: 12, padding: 6 }}>
                        Drop fields here
                      </span>
                    ) : (
                      columns.map((k, i) => {
                        const f = fieldMap.get(k);
                        if (!f) return null;
                        return (
                          <div
                            key={k}
                            draggable
                            onDragStart={(e) => handleDragStartColumn(e, i)}
                            style={{ ...CHIP, cursor: 'grab' }}
                          >
                            {dot(f.type)}
                            {f.label}
                            <button
                              type="button"
                              onClick={() => removeColumn(k)}
                              style={CHIP_X}
                              aria-label={`Remove ${f.label}`}
                            >
                              ×
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>

              {/* Filters — legacy L17581 */}
              <div className="panel" style={{ marginBottom: 0 }}>
                <div className="panel-body">
                  <div style={ZONE_TITLE}>
                    Filters <span style={ZONE_HINT}>(drag fields here)</span>
                  </div>
                  <div
                    onDragOver={allowDrop}
                    onDrop={handleDropFilters}
                    style={{
                      minHeight: 44,
                      border: '1.5px dashed var(--amber)',
                      borderRadius: 8,
                      padding: 8,
                    }}
                  >
                    {filters.map((f) => {
                      const fd = fieldMap.get(f.field);
                      const ops = opsForType(fd?.type ?? 'text');
                      return (
                        <div
                          key={f.field}
                          style={{
                            display: 'flex',
                            gap: 8,
                            alignItems: 'center',
                            padding: '8px 12px',
                            background: 'var(--bg)',
                            border: '1px solid var(--border)',
                            borderRadius: 8,
                            marginBottom: 6,
                            flexWrap: 'wrap',
                          }}
                        >
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 700,
                              color: dotColor(fd?.type ?? 'text'),
                              minWidth: 80,
                            }}
                          >
                            {fd ? fd.label : f.field}
                          </span>
                          <select
                            value={f.op}
                            onChange={(e) =>
                              setFilters((prev) =>
                                prev.map((x) =>
                                  x.field === f.field
                                    ? { ...x, op: e.target.value as FilterOp }
                                    : x,
                                ),
                              )
                            }
                            style={COMPACT_CONTROL}
                          >
                            {ALL_OPS.map((op) => (
                              <option key={op} value={op} disabled={!ops.includes(op)}>
                                {OP_LABELS[op]}
                              </option>
                            ))}
                          </select>
                          <input
                            type={fd?.type === 'date' || fd?.type === 'datetime' ? 'date' : 'text'}
                            value={f.value}
                            onChange={(e) =>
                              setFilters((prev) =>
                                prev.map((x) =>
                                  x.field === f.field ? { ...x, value: e.target.value } : x,
                                ),
                              )
                            }
                            placeholder="Value"
                            style={{ ...COMPACT_CONTROL, flex: 1, minWidth: 100 }}
                          />
                          <button
                            type="button"
                            onClick={() => removeFilter(f.field)}
                            style={{ ...CHIP_X, color: 'var(--red)' }}
                            aria-label={`Remove ${fd ? fd.label : f.field} filter`}
                          >
                            ✖
                          </button>
                        </div>
                      );
                    })}
                    <div
                      style={{
                        padding: 6,
                        textAlign: 'center',
                        color: 'var(--text3)',
                        fontSize: 11,
                        border: '1.5px dashed var(--border)',
                        borderRadius: 6,
                      }}
                    >
                      Drop a field here to add filter
                    </div>
                  </div>
                </div>
              </div>

              {/* Group By — legacy L17587 */}
              <div className="panel" style={{ marginBottom: 0 }}>
                <div className="panel-body">
                  <div style={ZONE_TITLE}>
                    Group By <span style={ZONE_HINT}>(one field for summary sheet)</span>
                  </div>
                  <div
                    onDragOver={allowDrop}
                    onDrop={handleDropGroup}
                    style={{
                      minHeight: 36,
                      border: '1.5px dashed var(--purple)',
                      borderRadius: 8,
                      padding: 8,
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 6,
                    }}
                  >
                    {!groupBy ? (
                      <span style={{ color: 'var(--text3)', fontSize: 12, padding: 4 }}>
                        Drop a field here
                      </span>
                    ) : (
                      (() => {
                        const f = fieldMap.get(groupBy);
                        if (!f) return null;
                        return (
                          <div style={CHIP}>
                            {dot(f.type)}
                            {f.label}
                            <button
                              type="button"
                              onClick={() => {
                                setGroupBy(null);
                                setSumCol(null);
                              }}
                              style={CHIP_X}
                              aria-label={`Remove ${f.label}`}
                            >
                              ×
                            </button>
                          </div>
                        );
                      })()
                    )}
                  </div>
                  {groupBy && numericFields.length > 0 ? (
                    <div
                      style={{
                        display: 'flex',
                        gap: 12,
                        marginTop: 8,
                        alignItems: 'center',
                        flexWrap: 'wrap',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontSize: 11, color: 'var(--text3)' }}>Summarize:</span>
                        <select
                          value={sumCol ?? ''}
                          onChange={(e) => setSumCol(e.target.value || null)}
                          style={COMPACT_CONTROL}
                        >
                          <option value="">— none —</option>
                          {numericFields.map((f) => (
                            <option key={f.key} value={f.key}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontSize: 11, color: 'var(--text3)' }}>Function:</span>
                        <select
                          value={sumFn}
                          onChange={(e) => setSumFn(e.target.value as AggFunction)}
                          style={COMPACT_CONTROL}
                          disabled={!sumCol}
                        >
                          {AGG_OPTIONS.map((fn) => (
                            <option key={fn} value={fn}>
                              {fn}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          {/* Actions — legacy L17597 */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 16,
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {/* Legacy saves from the header via prompt() (_rbSaveTemplate L17673);
              here the Report Details panel owns the name, so the submit sits
              with the other actions. */}
              <button
                type="submit"
                className="btn btn-primary"
                disabled={saving || columns.length === 0 || !name.trim()}
              >
                {saving ? <Loader2 className="animate-spin" /> : null}💾 {saveLabel}
              </button>
              {onExcel ? (
                <button
                  type="button"
                  className="btn btn-success"
                  style={{ fontSize: 14, padding: '8px 28px', fontWeight: 700 }}
                  onClick={() => onExcel(buildSpec())}
                  disabled={columns.length === 0 || excelLoading}
                >
                  📄 Generate Excel
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ fontSize: 12 }}
                onClick={onPreviewClick}
                disabled={previewLoading || columns.length === 0}
              >
                Preview
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ fontSize: 11, color: 'var(--text3)' }}
                onClick={onClearAll}
              >
                Clear All
              </button>
            </div>
          </div>

          {/* Preview pane — legacy renders `_rbPreview` here (L17603) */}
          {previewLoading || preview || previewError ? (
            <ResultTable
              data={preview}
              isLoading={previewLoading}
              isError={Boolean(previewError)}
              errorMessage={previewError}
              filenamePrefix="preview"
              onExcel={onExcel ? () => onExcel(buildSpec()) : undefined}
              excelLoading={excelLoading}
            />
          ) : null}
        </>
      ) : null}
    </form>
  );
}
