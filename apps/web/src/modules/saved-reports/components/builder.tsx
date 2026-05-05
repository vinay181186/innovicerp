// Drag-and-drop ad-hoc report builder (T-041b).
//
// Mirrors legacy `renderReportBuilder` (legacy HTML L17434+):
//   - Source picker tabs at the top
//   - Available fields list on the left, draggable
//   - Three drop zones on the right: Columns, Filters, Group By
//   - Live preview button + result pane
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
import { Eye, Loader2, X } from 'lucide-react';
import { useMemo, useState, type DragEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { ResultTable } from './result-table';

interface Props {
  sources: SourceDescriptor[];
  initial: BuilderInitial;
  onSave: (input: SaveInput) => void;
  onPreview: (spec: AdHocSpec) => void;
  preview: RunAdHocResponse | undefined;
  previewLoading: boolean;
  previewError?: string | undefined;
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

const TYPE_DOT: Record<string, string> = {
  number: 'bg-emerald-500',
  date: 'bg-amber-500',
  datetime: 'bg-amber-500',
  text: 'bg-violet-500',
};

const ALL_OPS: FilterOp[] = ['equals', 'notEquals', 'contains', 'gt', 'lt', 'after', 'before'];
const TEXT_OPS: FilterOp[] = ['equals', 'notEquals', 'contains'];
const NUMBER_OPS: FilterOp[] = ['equals', 'notEquals', 'gt', 'lt'];
const DATE_OPS: FilterOp[] = ['equals', 'after', 'before'];

const OP_LABELS: Record<FilterOp, string> = {
  equals: 'equals',
  notEquals: 'not equals',
  contains: 'contains',
  gt: '>',
  lt: '<',
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
    <form onSubmit={onSubmit} className="space-y-6">
      {/* Save panel */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Report details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="rb-name">Name</Label>
              <Input
                id="rb-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Open SOs by client"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rb-desc">Description</Label>
              <Input
                id="rb-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="optional"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isShared}
                onChange={(e) => setIsShared(e.target.checked)}
                className="h-4 w-4 rounded border"
              />
              <span>
                <span className="font-medium">Shared</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  Visible to everyone in the company; only you (or admin/manager) can edit.
                </span>
              </span>
            </label>
          </div>
          {saveError ? <p className="mt-2 text-sm text-destructive">{saveError}</p> : null}
        </CardContent>
      </Card>

      {/* Source picker */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Data source</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {sources.map((s) => {
              const sel = s.sourceKey === sourceKey;
              return (
                <button
                  key={s.sourceKey}
                  type="button"
                  onClick={() => onChangeSource(s.sourceKey)}
                  className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                    sel
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-card text-muted-foreground hover:bg-accent'
                  }`}
                >
                  {s.label}
                  <span className="ml-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {s.group}
                  </span>
                </button>
              );
            })}
          </div>
          {source ? (
            <p className="mt-2 text-xs text-muted-foreground">{source.description}</p>
          ) : null}
        </CardContent>
      </Card>

      {/* Builder grid */}
      <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
        {/* Available fields */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Available fields</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">
              Drag → into zones
            </p>
            {(source?.fields ?? []).map((f) => {
              const used = usedKeys.has(f.key);
              return (
                <div
                  key={f.key}
                  draggable={!used}
                  onDragStart={(e) => handleDragStartField(e, f.key)}
                  className={`flex items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-xs ${
                    used
                      ? 'cursor-not-allowed opacity-40 line-through'
                      : 'cursor-grab hover:bg-accent'
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full ${TYPE_DOT[f.type] ?? 'bg-slate-400'}`} />
                  <span>{f.label}</span>
                </div>
              );
            })}
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
                text
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                number
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                date
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Drop zones */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Columns</CardTitle>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Order = display order
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <div
                onDragOver={allowDrop}
                onDrop={handleDropColumns}
                className="flex min-h-[60px] flex-wrap gap-2 rounded-md border border-dashed bg-muted/30 p-3"
              >
                {columns.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Drop fields here</p>
                ) : (
                  columns.map((k, i) => {
                    const f = fieldMap.get(k);
                    if (!f) return null;
                    return (
                      <span
                        key={k}
                        draggable
                        onDragStart={(e) => handleDragStartColumn(e, i)}
                        className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 text-xs"
                      >
                        <span
                          className={`h-2 w-2 rounded-full ${TYPE_DOT[f.type] ?? 'bg-slate-400'}`}
                        />
                        {f.label}
                        <button
                          type="button"
                          onClick={() => removeColumn(k)}
                          className="ml-0.5 text-muted-foreground hover:text-destructive"
                          aria-label={`Remove ${f.label}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Filters</CardTitle>
            </CardHeader>
            <CardContent>
              <div
                onDragOver={allowDrop}
                onDrop={handleDropFilters}
                className="space-y-2 rounded-md border border-dashed bg-muted/30 p-3"
              >
                {filters.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Drop fields here to add filters</p>
                ) : (
                  filters.map((f) => {
                    const fd = fieldMap.get(f.field);
                    if (!fd) return null;
                    const ops = opsForType(fd.type);
                    return (
                      <div
                        key={f.field}
                        className="flex flex-wrap items-center gap-2 rounded-md border bg-card p-2 text-xs"
                      >
                        <span
                          className={`h-2 w-2 rounded-full ${TYPE_DOT[fd.type] ?? 'bg-slate-400'}`}
                        />
                        <span className="min-w-[100px] font-medium">{fd.label}</span>
                        <Select
                          value={f.op}
                          onChange={(e) =>
                            setFilters((prev) =>
                              prev.map((x) =>
                                x.field === f.field ? { ...x, op: e.target.value as FilterOp } : x,
                              ),
                            )
                          }
                          className="h-7 text-xs"
                        >
                          {ALL_OPS.map((op) => (
                            <option key={op} value={op} disabled={!ops.includes(op)}>
                              {OP_LABELS[op]}
                            </option>
                          ))}
                        </Select>
                        <Input
                          type={fd.type === 'date' || fd.type === 'datetime' ? 'date' : 'text'}
                          value={f.value}
                          onChange={(e) =>
                            setFilters((prev) =>
                              prev.map((x) =>
                                x.field === f.field ? { ...x, value: e.target.value } : x,
                              ),
                            )
                          }
                          placeholder="value"
                          className="h-7 min-w-[120px] flex-1 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => removeFilter(f.field)}
                          className="text-muted-foreground hover:text-destructive"
                          aria-label={`Remove ${fd.label} filter`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Group by</CardTitle>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  One field for summary section
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <div
                onDragOver={allowDrop}
                onDrop={handleDropGroup}
                className="flex min-h-[44px] flex-wrap gap-2 rounded-md border border-dashed bg-muted/30 p-3"
              >
                {!groupBy ? (
                  <p className="text-xs text-muted-foreground">Drop a field here</p>
                ) : (
                  (() => {
                    const f = fieldMap.get(groupBy);
                    if (!f) return null;
                    return (
                      <span className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 text-xs">
                        <span
                          className={`h-2 w-2 rounded-full ${TYPE_DOT[f.type] ?? 'bg-slate-400'}`}
                        />
                        {f.label}
                        <button
                          type="button"
                          onClick={() => {
                            setGroupBy(null);
                            setSumCol(null);
                          }}
                          className="ml-0.5 text-muted-foreground hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    );
                  })()
                )}
              </div>
              {groupBy && numericFields.length > 0 ? (
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <Label className="text-xs text-muted-foreground">Summarise:</Label>
                  <Select
                    value={sumCol ?? ''}
                    onChange={(e) => setSumCol(e.target.value || null)}
                    className="h-7 text-xs"
                  >
                    <option value="">— none —</option>
                    {numericFields.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </Select>
                  <Label className="text-xs text-muted-foreground">Function:</Label>
                  <Select
                    value={sumFn}
                    onChange={(e) => setSumFn(e.target.value as AggFunction)}
                    className="h-7 text-xs"
                    disabled={!sumCol}
                  >
                    {AGG_OPTIONS.map((fn) => (
                      <option key={fn} value={fn}>
                        {fn}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={saving || columns.length === 0 || !name.trim()}>
          {saving ? <Loader2 className="animate-spin" /> : null}
          {saveLabel}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onPreviewClick}
          disabled={previewLoading || columns.length === 0}
        >
          <Eye />
          Preview
        </Button>
        <Button type="button" variant="ghost" onClick={onClearAll}>
          Clear all
        </Button>
      </div>

      {/* Preview pane */}
      {previewLoading || preview || previewError ? (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Preview
          </h2>
          <ResultTable
            data={preview}
            isLoading={previewLoading}
            isError={Boolean(previewError)}
            errorMessage={previewError}
            filenamePrefix="preview"
          />
        </div>
      ) : null}
    </form>
  );
}
