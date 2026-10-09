// The Multi-Level BOM form's line grid — one row per child item, the same
// controls as BOM Master's Child Items grid (bom-form.tsx). RM Grade / RM Size
// apply only to a Manufacture line, so they are disabled on Buy / Outsource.
// A sub-assembly link is resolved by the SERVER on save (ADR-225); the edit
// form only shows the link the server last returned.

import {
  BOM_LINE_TYPE_LABEL,
  BOM_LINE_TYPES,
  type BomLineType,
  type Item,
  QTY_STEP,
  qtyStepForUom,
} from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { Trash2 } from 'lucide-react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import {
  MaterialGradePicker,
  MaterialSizePicker,
} from '@/modules/raw-material/components/raw-material-pickers';
import { itemDisplayName, type ItemOption } from './use-ml-bom-items';

export interface MlBomFormLineDraft {
  /** Stable client-side row key, set once when the row is created / loaded. */
  rowKey: string;
  childItemId: string;
  childItemCodeText: string;
  qtyPerSet: string;
  bomType: BomLineType;
  rawMaterialGradeId: string | null;
  rawMaterialGradeText: string | null;
  rawMaterialSizeId: string | null;
  rawMaterialSizeText: string | null;
  remarks: string;
  /** Display only — the sub-assembly BOM the server linked on the last save. */
  childMlBomId: string | null;
  childMlBomCode: string | null;
}

let rowSeq = 0;
/** A fresh row key — unique within this browser session. */
export function newMlBomRowKey(): string {
  rowSeq += 1;
  return `mlbom-row-${rowSeq}`;
}

export function emptyMlBomLine(): MlBomFormLineDraft {
  return {
    rowKey: newMlBomRowKey(),
    childItemId: '',
    childItemCodeText: '',
    qtyPerSet: '1',
    bomType: 'manufacture',
    rawMaterialGradeId: null,
    rawMaterialGradeText: null,
    rawMaterialSizeId: null,
    rawMaterialSizeText: null,
    remarks: '',
    childMlBomId: null,
    childMlBomCode: null,
  };
}

const LINE_TYPES = BOM_LINE_TYPES.map((value) => ({ value, label: BOM_LINE_TYPE_LABEL[value] }));
const COLS = 10;

interface Props {
  mode: 'create' | 'edit';
  lines: MlBomFormLineDraft[];
  itemById: Map<string, Item>;
  itemOptions: ItemOption[];
  itemsFetching: boolean;
  onPick: (idx: number, id: string | null) => void;
  onSearch: (idx: number, term: string) => void;
  onChange: (idx: number, patch: Partial<MlBomFormLineDraft>) => void;
  onRemove: (idx: number) => void;
}

export function MlBomLinesTable(props: Props): React.JSX.Element {
  const { mode, lines, itemById, itemOptions, itemsFetching, onPick, onSearch, onChange } = props;
  return (
    <div className="tbl-wrap">
      <table className="innovic-table tbl-grid tbl-edit">
        <thead>
          <tr>
            <th className="th-num" style={{ width: 44 }}>
              Sr No
            </th>
            <th style={{ minWidth: 160 }}>
              Item Code<span className="req">★</span>
            </th>
            <th style={{ minWidth: 180 }}>Item Name</th>
            <th style={{ width: 60 }}>UOM</th>
            <th className="th-num" style={{ width: 100 }}>
              Qty per Set<span className="req">★</span>
            </th>
            <th style={{ width: 140 }}>Line Type</th>
            <th style={{ width: 150 }}>RM Grade</th>
            <th style={{ width: 150 }}>RM Size</th>
            <th style={{ minWidth: 160 }}>Remarks</th>
            <th style={{ width: 48 }} aria-label="Remove" />
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <tr>
              <td colSpan={COLS} className="empty-state">
                No lines.
              </td>
            </tr>
          ) : null}
          {lines.map((line, idx) => {
            const item = line.childItemId ? (itemById.get(line.childItemId) ?? null) : null;
            const name = itemDisplayName(item);
            const isMfg = line.bomType === 'manufacture';
            return (
              <tr key={line.rowKey}>
                <td className="td-num mono fw-700">{idx + 1}</td>
                <td>
                  <SearchableSelect
                    id={`mlbom-item-${idx}`}
                    value={line.childItemId || null}
                    onChange={(id) => onPick(idx, id)}
                    onSearch={(t) => onSearch(idx, t)}
                    loading={itemsFetching}
                    options={itemOptions}
                    placeholder="Search item code…"
                    emptyText="No matching item"
                    selectedLabel={(o) => o.code ?? o.name}
                    {...(item
                      ? { valueLabel: item.code }
                      : line.childItemCodeText
                        ? { valueLabel: line.childItemCodeText }
                        : {})}
                  />
                  {mode === 'edit' && line.childMlBomId && line.childMlBomCode ? (
                    <div style={{ marginTop: 2 }}>
                      <Link
                        to="/ml-boms/$id"
                        params={{ id: line.childMlBomId }}
                        className="td-code"
                        style={{ fontSize: 'var(--fs-xs)' }}
                      >
                        {line.childMlBomCode}
                      </Link>
                    </div>
                  ) : null}
                </td>
                <td
                  className="text2"
                  style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}
                  title={name || undefined}
                >
                  {name || <span className="text3">—</span>}
                </td>
                <td className="mono">{item?.uom ?? <span className="text3">—</span>}</td>
                <td className="td-num">
                  <input
                    type="number"
                    min={item ? qtyStepForUom(item.uom) : QTY_STEP}
                    step={item ? qtyStepForUom(item.uom) : QTY_STEP}
                    className="innovic-input mono"
                    aria-label={`Qty per Set, line ${idx + 1}`}
                    value={line.qtyPerSet}
                    onChange={(e) => onChange(idx, { qtyPerSet: e.target.value })}
                  />
                </td>
                <td>
                  <select
                    className="innovic-select"
                    aria-label={`Line Type, line ${idx + 1}`}
                    value={line.bomType}
                    onChange={(e) => {
                      const bomType = e.target.value as BomLineType;
                      // Raw material and the sub-assembly link belong to a
                      // Manufacture line only — the server drops the link on a
                      // Buy / Outsource line, so the screen must not show it.
                      onChange(
                        idx,
                        bomType === 'manufacture'
                          ? { bomType }
                          : {
                              bomType,
                              rawMaterialGradeId: null,
                              rawMaterialGradeText: null,
                              rawMaterialSizeId: null,
                              rawMaterialSizeText: null,
                              childMlBomId: null,
                              childMlBomCode: null,
                            },
                      );
                    }}
                  >
                    {LINE_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <MaterialGradePicker
                    ariaLabel={`RM Grade, line ${idx + 1}`}
                    id={`mlbom-line-grade-${idx}`}
                    disabled={!isMfg}
                    valueId={line.rawMaterialGradeId}
                    valueText={line.rawMaterialGradeText}
                    onChange={(gradeId, text) =>
                      onChange(idx, { rawMaterialGradeId: gradeId, rawMaterialGradeText: text })
                    }
                  />
                </td>
                <td>
                  <MaterialSizePicker
                    ariaLabel={`RM Size, line ${idx + 1}`}
                    id={`mlbom-line-size-${idx}`}
                    disabled={!isMfg}
                    valueId={line.rawMaterialSizeId}
                    valueText={line.rawMaterialSizeText}
                    onChange={(sizeId, text) =>
                      onChange(idx, { rawMaterialSizeId: sizeId, rawMaterialSizeText: text })
                    }
                  />
                </td>
                <td>
                  <input
                    className="innovic-input"
                    aria-label={`Remarks, line ${idx + 1}`}
                    maxLength={500}
                    value={line.remarks}
                    onChange={(e) => onChange(idx, { remarks: e.target.value })}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ color: 'var(--red2)' }}
                    onClick={() => props.onRemove(idx)}
                    title="Remove line"
                    aria-label={`Remove line ${idx + 1}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
