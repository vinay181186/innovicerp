// Multi-Level Plan create + edit form (ADR-225 phase 3). Same layout as the
// Multi-Level BOM form: sticky PageHeader (Cancel + blue Save, Ctrl+S, "Not
// saved") → one Panel with the ClusterGrid.
//
// Create: pick an SO line from the server's eligible-lines list (the server
// decides which lines qualify — CLAUDE.md §20.5); Item / Order Qty / BOM No.
// follow the picked line, and Plan Qty resets to its Order Qty each time the
// line changes (a cleared line clears it). Edit (draft only): Plan Qty and
// Remarks; the line is fixed.

import type { MlPlanEligibleLine } from '@innovic/shared';
import { useMemo, useRef, useState } from 'react';
import { SearchableSelect, type SearchableOption } from '@/components/shared/searchable-select';
import { Panel } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { Cluster, ClusterGrid, FormField } from '@/ui/forms';
import { PageHeader, useSaveShortcut } from '@/ui/layout';
import { useMlPlanEligibleLines, useNextMlPlanNo } from '../api';

/** What the form shows for the SO line — an eligible line on create, the
 *  plan's own copy on edit. */
export type MlPlanFormLine = Pick<
  MlPlanEligibleLine,
  'soLineId' | 'soCode' | 'lineNo' | 'itemCode' | 'itemName' | 'orderQty' | 'mlBomCode'
>;

export interface MlPlanFormDraft {
  planQty: string;
  remarks: string;
}

export function soLineLabel(l: Pick<MlPlanFormLine, 'soCode' | 'lineNo' | 'itemCode'>): string {
  return `${l.soCode} · L${l.lineNo} · ${l.itemCode ?? '—'}`;
}

interface MlPlanFormProps {
  mode: 'create' | 'edit';
  /** Edit: the plan's MLP No. */
  code?: string | undefined;
  /** Edit: the plan's line. Create: the line preselected from the URL, if any. */
  initialLine: MlPlanFormLine | null;
  /** Create: the URL asked for a line that is not on the eligible list. */
  preselectMissing?: boolean | undefined;
  initial: MlPlanFormDraft;
  onSubmit: (line: MlPlanFormLine, draft: MlPlanFormDraft) => Promise<void>;
  submitting: boolean;
  submitError: string | null;
  onCancel: () => void;
}

export function MlPlanForm(props: MlPlanFormProps): React.JSX.Element {
  const { mode, initialLine, initial, onSubmit, submitting, submitError } = props;
  const [line, setLine] = useState<MlPlanFormLine | null>(initialLine);
  const [draft, setDraft] = useState<MlPlanFormDraft>(initial);

  // ADR-224: the create-mode MLP No. is a preview; the server numbers on save.
  const { data: nextNo } = useNextMlPlanNo({ enabled: mode === 'create' });
  const code = mode === 'create' ? (nextNo?.code ?? '') : (props.code ?? '');

  const [lineSearch, setLineSearch] = useState('');
  const eligible = useMlPlanEligibleLines(lineSearch.trim() ? { search: lineSearch.trim() } : {}, {
    enabled: mode === 'create',
  });
  const lineById = useMemo(() => {
    const m = new Map<string, MlPlanEligibleLine>();
    for (const l of eligible.data?.lines ?? []) m.set(l.soLineId, l);
    return m;
  }, [eligible.data]);
  const lineOptions = useMemo<SearchableOption[]>(
    () =>
      (eligible.data?.lines ?? []).map((l) => ({
        id: l.soLineId,
        code: soLineLabel(l),
        name: l.itemName ?? '',
      })),
    [eligible.data],
  );

  const onLinePick = (id: string | null): void => {
    const picked = id ? (lineById.get(id) ?? null) : null;
    setLine(picked);
    // Plan Qty follows the line: its Order Qty, or blank when cleared.
    setDraft((d) => ({ ...d, planQty: picked ? String(picked.orderQty) : '' }));
  };

  const planQtyNum = Number(draft.planQty);
  const validationError = ((): string | null => {
    if (!line) return 'SO Line is required.';
    if (draft.planQty.trim() === '') return 'Plan Qty is required.';
    if (!Number.isInteger(planQtyNum) || planQtyNum <= 0) {
      return 'Plan Qty must be a whole number greater than 0.';
    }
    if (planQtyNum > line.orderQty) {
      return `Plan Qty cannot be more than Order Qty (${line.orderQty}).`;
    }
    return null;
  })();

  const save = async (): Promise<void> => {
    if (validationError || submitting || !line) return;
    await onSubmit(line, draft);
  };
  useSaveShortcut(() => void save(), !validationError && !submitting);

  const initialSnapshot = useRef(JSON.stringify({ l: initialLine?.soLineId ?? null, d: initial }));
  const isDirty =
    JSON.stringify({ l: line?.soLineId ?? null, d: draft }) !== initialSnapshot.current;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <PageHeader
        sticky
        title={mode === 'create' ? 'New Multi-Level Plan' : `Edit ${code}`}
        dirty={isDirty}
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={props.onCancel}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={Boolean(validationError) || submitting}
              title={validationError ?? 'Save (Ctrl+S)'}
            >
              {submitting ? 'Saving…' : mode === 'create' ? 'Save Plan' : 'Save Changes'}
            </button>
          </>
        }
      />

      {props.preselectMissing && !line ? (
        <Banner tone="warn">This SO line cannot have a Multi-Level Plan.</Banner>
      ) : null}
      {validationError ? <Banner tone="warn">{validationError}</Banner> : null}
      {submitError ? (
        <Banner tone="error" role="alert">
          {submitError}
        </Banner>
      ) : null}

      <Panel>
        <ClusterGrid>
          <Cluster name="Plan">
            <FormField label="MLP No." htmlFor="mlplan-no">
              <input
                id="mlplan-no"
                className="innovic-input mono cl-cap-md"
                value={code}
                readOnly
                title={mode === 'create' ? 'Numbered automatically when you save' : undefined}
                placeholder="IN-MLP-NNNNN"
              />
            </FormField>
            <FormField
              label="SO Line"
              required={mode === 'create'}
              htmlFor="mlplan-so-line"
              className="cl-span-2"
            >
              {mode === 'create' ? (
                <SearchableSelect
                  id="mlplan-so-line"
                  value={line?.soLineId ?? null}
                  onChange={onLinePick}
                  onSearch={setLineSearch}
                  loading={eligible.isFetching}
                  options={lineOptions}
                  placeholder="Search SO no., item code…"
                  emptyText="No matching SO line"
                  selectedLabel={(o) => o.code ?? o.name}
                  {...(line ? { valueLabel: soLineLabel(line) } : {})}
                />
              ) : (
                <input
                  id="mlplan-so-line"
                  className="innovic-input is-derived mono"
                  value={line ? soLineLabel(line) : ''}
                  readOnly
                />
              )}
            </FormField>
          </Cluster>

          <Cluster name="Item">
            <FormField label="Item Code" htmlFor="mlplan-item">
              <input
                id="mlplan-item"
                className="innovic-input is-derived mono cl-cap-md"
                style={{ color: 'var(--text)', fontWeight: 700 }}
                value={line?.itemCode ?? ''}
                readOnly
              />
            </FormField>
            <FormField label="Item Name" htmlFor="mlplan-item-name" className="cl-span-2">
              <input
                id="mlplan-item-name"
                className="innovic-input is-derived"
                style={{ textOverflow: 'ellipsis' }}
                value={line?.itemName ?? ''}
                title={line?.itemName ?? undefined}
                readOnly
              />
            </FormField>
            <FormField label="BOM No." htmlFor="mlplan-bom">
              <input
                id="mlplan-bom"
                className="innovic-input is-derived mono cl-cap-md"
                value={line?.mlBomCode ?? ''}
                readOnly
              />
            </FormField>
          </Cluster>

          <Cluster name="Quantity">
            <FormField label="Order Qty" htmlFor="mlplan-order-qty">
              <input
                id="mlplan-order-qty"
                className="innovic-input is-derived mono cl-num cl-cap"
                value={line ? String(line.orderQty) : ''}
                readOnly
              />
            </FormField>
            <FormField label="Plan Qty" required htmlFor="mlplan-plan-qty">
              <input
                id="mlplan-plan-qty"
                type="number"
                min={1}
                step={1}
                {...(line ? { max: line.orderQty } : {})}
                className={`innovic-input mono cl-num cl-cap${
                  draft.planQty !== '' && validationError?.startsWith('Plan Qty') ? ' is-bad' : ''
                }`}
                value={draft.planQty}
                disabled={!line}
                onChange={(e) => setDraft((d) => ({ ...d, planQty: e.target.value }))}
              />
            </FormField>
          </Cluster>

          <Cluster name="Notes">
            <FormField label="Remarks" htmlFor="mlplan-remarks" className="cl-span-4">
              <textarea
                id="mlplan-remarks"
                className="innovic-textarea"
                rows={2}
                maxLength={1000}
                value={draft.remarks}
                onChange={(e) => setDraft((d) => ({ ...d, remarks: e.target.value }))}
              />
            </FormField>
          </Cluster>
        </ClusterGrid>
      </Panel>
    </form>
  );
}
