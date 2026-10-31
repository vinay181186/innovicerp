// Stock Count line — the Drawing Rev bucket counted (Phase C). A MAKE item
// with Revs is counted per Item + Rev (ABC/1, ABC/2, or "No Rev" for old
// stock); an item without Revs shows a dash and the line goes as before.

import { itemRevLabel } from '@innovic/shared';
import {
  DrawingRevPicker,
  NO_REV_OPTION,
  pickedRevisionId,
  useItemRevOptions,
} from '@/modules/item-revisions/components/drawing-rev-picker';
import type { DraftLine } from '../lib/draft-line';

export function StockCountRevCell({
  line,
  editable,
  onChange,
}: {
  line: DraftLine;
  editable: boolean;
  onChange: (itemRevisionId: string | null | undefined) => void;
}): React.JSX.Element {
  const { required, options } = useItemRevOptions(line.itemId);
  if (!required) return <span className="text3">—</span>;
  const value =
    line.itemRevisionId === undefined
      ? null
      : line.itemRevisionId === null
        ? NO_REV_OPTION
        : line.itemRevisionId;
  if (!editable) {
    if (line.itemRevisionId === undefined) return <span className="text3">—</span>;
    if (line.itemRevisionId === null)
      return <span className="text3">{line.itemCode} · no Rev</span>;
    const opt = options.find((o) => o.id === line.itemRevisionId);
    return <span className="mono fw-700">{opt?.code ?? itemRevLabel(line.itemCode, null)}</span>;
  }
  return (
    <div>
      <DrawingRevPicker
        itemId={line.itemId}
        value={value}
        ariaLabel={`Drawing Rev, ${line.itemCode}`}
        onChange={(v) => onChange(v ? pickedRevisionId(v) : undefined)}
      />
      {value === null ? <div className="form-error">Drawing Rev is required.</div> : null}
    </div>
  );
}
