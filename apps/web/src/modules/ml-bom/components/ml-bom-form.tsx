// Multi-Level BOM create + edit form (ADR-225). Same layout as BOM Master's
// form (bom-master/components/bom-form.tsx): sticky PageHeader (Cancel + blue
// Save, Ctrl+S, "Not saved") → one Panel with the ClusterGrid → Lines panel.
// No Excel import (phase 2).

import { type MlBomLineInput, qtyUomProblem } from '@innovic/shared';
import { Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { Panel } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { Cluster, ClusterGrid, FormField } from '@/ui/forms';
import { PageHeader, useSaveShortcut } from '@/ui/layout';
import { useNextMlBomNo } from '../api';
import { MlBomLinesTable, type MlBomFormLineDraft, emptyMlBomLine } from './ml-bom-lines-table';
import { itemDisplayName, useMlBomItems } from './use-ml-bom-items';

export type { MlBomFormLineDraft } from './ml-bom-lines-table';

export interface MlBomFormHeaderDraft {
  code: string;
  itemId: string;
  itemCodeText: string;
  isDefault: boolean;
  remarks: string;
}

interface MlBomFormProps {
  mode: 'create' | 'edit';
  /** Edit only: the saved BOM Rev (the save raises it by one). */
  revision?: number | undefined;
  initialHeader: MlBomFormHeaderDraft;
  initialLines: MlBomFormLineDraft[];
  onSubmit: (
    header: MlBomFormHeaderDraft,
    lines: MlBomFormLineDraft[],
    revisionNote: string | null,
  ) => Promise<void>;
  submitting: boolean;
  submitError: string | null;
  onCancel: () => void;
}

export function MlBomForm(props: MlBomFormProps): React.JSX.Element {
  const { mode, revision, initialHeader, initialLines, onSubmit, submitting, submitError } = props;
  const [header, setHeader] = useState<MlBomFormHeaderDraft>(initialHeader);
  const [lines, setLines] = useState<MlBomFormLineDraft[]>(initialLines);
  const [revisionNote, setRevisionNote] = useState('');

  // ADR-224: the create-mode BOM No. is a preview; the server numbers on save.
  const { data: nextNo } = useNextMlBomNo({ enabled: mode === 'create' });
  useEffect(() => {
    if (mode !== 'create') return;
    const code = nextNo?.code;
    if (!code) return;
    setHeader((prev) => (prev.code === code ? prev : { ...prev, code }));
  }, [mode, nextNo]);

  const referenced = useMemo(
    () => [header.itemId, ...lines.map((l) => l.childItemId)],
    [header.itemId, lines],
  );
  const { setItemSearch, itemsFetching, itemOptions, itemById, resolveCode } =
    useMlBomItems(referenced);

  // Paste-and-go: a typed exact code resolves to its item at save time.
  const resolvedItemId = header.itemId || resolveCode(header.itemCodeText)?.id || '';
  const item = resolvedItemId ? (itemById.get(resolvedItemId) ?? null) : null;
  const resolvedLines = lines.map((l) => {
    if (l.childItemId) return l;
    const hit = resolveCode(l.childItemCodeText);
    return hit ? { ...l, childItemId: hit.id, childItemCodeText: hit.code } : l;
  });

  const updateLine = (idx: number, patch: Partial<MlBomFormLineDraft>): void => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };
  const onLinePick = (idx: number, id: string | null): void => {
    // A new item means the old sub-assembly link no longer applies.
    if (!id) {
      updateLine(idx, { childItemId: '', childMlBomId: null, childMlBomCode: null });
      return;
    }
    const picked = itemById.get(id) ?? itemOptions.find((o) => o.id === id);
    updateLine(idx, {
      childItemId: id,
      childItemCodeText: picked?.code ?? '',
      childMlBomId: null,
      childMlBomCode: null,
    });
  };
  const onLineSearch = (idx: number, term: string): void => {
    setItemSearch(term);
    const line = lines[idx];
    if (line && !line.childItemId) updateLine(idx, { childItemCodeText: term });
  };
  const onItemPick = (id: string | null): void => {
    if (!id) {
      setHeader((h) => ({ ...h, itemId: '' }));
      return;
    }
    const picked = itemById.get(id) ?? itemOptions.find((o) => o.id === id);
    setHeader((h) => ({ ...h, itemId: id, itemCodeText: picked?.code ?? '' }));
  };
  const onItemSearch = (term: string): void => {
    setItemSearch(term);
    setHeader((h) => (h.itemId ? h : { ...h, itemCodeText: term }));
  };

  const validationError = ((): string | null => {
    if (!resolvedItemId) {
      return header.itemCodeText.trim()
        ? `Item Code "${header.itemCodeText.trim()}" is not in Item Master. Pick it from the list.`
        : 'Item Code is required.';
    }
    if (resolvedLines.length === 0) return 'Add at least one line.';
    const seen = new Map<string, number>();
    for (let i = 0; i < resolvedLines.length; i++) {
      const l = resolvedLines[i]!;
      if (!l.childItemId) {
        return l.childItemCodeText.trim()
          ? `Row #${i + 1}: Item Code "${l.childItemCodeText.trim()}" is not in Item Master. Pick it from the list.`
          : `Row #${i + 1}: Item Code is required.`;
      }
      if (l.childItemId === resolvedItemId) {
        return `Row #${i + 1}: a BOM cannot contain its own item.`;
      }
      const first = seen.get(l.childItemId);
      if (first !== undefined) {
        return `Row #${i + 1}: Item Code ${l.childItemCodeText.trim()} is already on row #${first + 1}.`;
      }
      seen.set(l.childItemId, i);
      const qty = Number(l.qtyPerSet);
      if (!Number.isFinite(qty) || qty <= 0) {
        return `Row #${i + 1}: Qty per Set must be greater than 0.`;
      }
      const unitProblem = qtyUomProblem(qty, itemById.get(l.childItemId)?.uom, 'Qty per Set');
      if (unitProblem) return `Row #${i + 1}: ${unitProblem}`;
    }
    return null;
  })();

  const save = async (): Promise<void> => {
    if (validationError || submitting) return;
    await onSubmit(
      { ...header, itemId: resolvedItemId },
      resolvedLines,
      mode === 'edit' && revisionNote.trim() ? revisionNote.trim() : null,
    );
  };
  useSaveShortcut(() => void save(), !validationError && !submitting);

  // "Not saved" pill — the auto-filled create-mode BOM No. is not an edit.
  const initialSnapshot = useRef(
    JSON.stringify({ h: { ...initialHeader, code: '' }, l: initialLines }),
  );
  const isDirty =
    revisionNote.trim() !== '' ||
    JSON.stringify({ h: { ...header, code: '' }, l: lines }) !== initialSnapshot.current;

  const filled = resolvedLines.filter((l) => l.childItemId).length;
  const itemName = itemDisplayName(item);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <PageHeader
        sticky
        title={mode === 'create' ? 'New Multi-Level BOM' : `Edit ${header.code}`}
        subtitle={
          mode === 'edit' ? (
            <span className="badge b-grey">
              BOM Rev {revision ?? 1} → {(revision ?? 1) + 1}
            </span>
          ) : undefined
        }
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
              {submitting ? 'Saving…' : mode === 'create' ? 'Save BOM' : 'Save Changes'}
            </button>
          </>
        }
      />

      {validationError ? <Banner tone="warn">{validationError}</Banner> : null}
      {submitError ? (
        <Banner tone="error" role="alert">
          {submitError}
        </Banner>
      ) : null}

      <Panel>
        <ClusterGrid>
          <Cluster name="BOM">
            <FormField label="BOM No." htmlFor="mlbom-no">
              <input
                id="mlbom-no"
                className="innovic-input mono cl-cap-md"
                value={header.code}
                readOnly
                title={mode === 'create' ? 'Numbered automatically when you save' : undefined}
                placeholder="IN-MLB-NNNNN"
              />
            </FormField>
            <FormField label="BOM Rev" htmlFor="mlbom-rev">
              <input
                id="mlbom-rev"
                className="innovic-input is-derived cl-num cl-cap"
                value={String(revision ?? 1)}
                readOnly
              />
            </FormField>
            {mode === 'create' ? (
              <FormField label="Default" htmlFor="mlbom-default">
                <input
                  id="mlbom-default"
                  type="checkbox"
                  checked={header.isDefault}
                  onChange={(e) => setHeader((h) => ({ ...h, isDefault: e.target.checked }))}
                />
              </FormField>
            ) : null}
          </Cluster>

          <Cluster name="Item">
            <FormField label="Item Code" required={mode === 'create'} htmlFor="mlbom-item">
              {mode === 'create' ? (
                <SearchableSelect
                  className="cl-cap-md"
                  id="mlbom-item"
                  value={resolvedItemId || null}
                  onChange={onItemPick}
                  onSearch={onItemSearch}
                  loading={itemsFetching}
                  options={itemOptions}
                  placeholder="Search item code…"
                  emptyText="No matching item"
                  selectedLabel={(o) => o.code ?? o.name}
                  {...(item
                    ? { valueLabel: item.code }
                    : header.itemCodeText
                      ? { valueLabel: header.itemCodeText }
                      : {})}
                />
              ) : (
                // Fixed after create — the BOM belongs to this item.
                <input
                  id="mlbom-item"
                  className="innovic-input is-derived mono cl-cap-md"
                  style={{ color: 'var(--text)', fontWeight: 700 }}
                  value={item?.code ?? header.itemCodeText}
                  readOnly
                />
              )}
            </FormField>
            <FormField label="Item Name" htmlFor="mlbom-item-name" className="cl-span-2">
              <input
                id="mlbom-item-name"
                className="innovic-input is-derived"
                style={
                  itemName
                    ? { color: 'var(--text)', fontWeight: 600, textOverflow: 'ellipsis' }
                    : undefined
                }
                value={itemName}
                title={itemName || undefined}
                readOnly
              />
            </FormField>
          </Cluster>

          {/* Continues the Item cluster: same four tracks, no second gutter word. */}
          <Cluster name={null}>
            <FormField label="Remarks" htmlFor="mlbom-remarks" className="cl-span-4">
              <textarea
                id="mlbom-remarks"
                className="innovic-textarea"
                rows={2}
                maxLength={1000}
                value={header.remarks}
                onChange={(e) => setHeader((h) => ({ ...h, remarks: e.target.value }))}
              />
            </FormField>
          </Cluster>
        </ClusterGrid>
      </Panel>

      <Panel
        title="Lines"
        bodyPadding="none"
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
            <span className="text3 mono">
              {filled} of {lines.length}
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setLines((prev) => [...prev, emptyMlBomLine()])}
            >
              <Plus size={12} /> Add Line
            </button>
          </div>
        }
      >
        <MlBomLinesTable
          mode={mode}
          lines={resolvedLines}
          itemById={itemById}
          itemOptions={itemOptions}
          itemsFetching={itemsFetching}
          onPick={onLinePick}
          onSearch={onLineSearch}
          onChange={updateLine}
          onRemove={(idx) => setLines((prev) => prev.filter((_, i) => i !== idx))}
        />
      </Panel>

      {mode === 'edit' ? (
        <Panel title="Revision Note">
          <textarea
            id="mlbom-rev-note"
            className="innovic-textarea"
            rows={2}
            maxLength={2000}
            aria-label="Revision Note"
            value={revisionNote}
            onChange={(e) => setRevisionNote(e.target.value)}
          />
        </Panel>
      ) : null}
    </form>
  );
}

/** Lines → the contract's line input. Every RM field is always sent (an edit
 *  replaces the lines wholesale, so a cleared picker must arrive as null). */
export function mlBomLinesToInput(lines: MlBomFormLineDraft[]): MlBomLineInput[] {
  return lines.map((l) => ({
    childItemId: l.childItemId,
    qtyPerSet: Number(l.qtyPerSet),
    bomType: l.bomType,
    rawMaterialGradeId: l.rawMaterialGradeId,
    rawMaterialGradeText: l.rawMaterialGradeText,
    rawMaterialSizeId: l.rawMaterialSizeId,
    rawMaterialSizeText: l.rawMaterialSizeText,
    remarks: l.remarks.trim() ? l.remarks.trim() : null,
  }));
}
