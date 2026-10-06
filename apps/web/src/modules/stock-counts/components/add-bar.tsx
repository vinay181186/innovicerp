// Stock Count add-item bar (ADR-193 phase 2): type-to-search item picker,
// Excel upload and template download. The template itself is built by the API
// (GET /import-templates/stock-count.xlsx) so its columns can carry real Excel
// dropdowns, which SheetJS cannot write; a failed download is reported through
// the screen's own message line (`onError`).
import { Download, Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { apiDownload } from '@/lib/api';
import { useItemsList } from '@/modules/items/api';
import { SearchableSelect } from '@/ui/forms';
import { resolveStockCountItems } from '../api';
import type { DraftLine } from '../lib/draft-line';

export function StockCountAddBar(props: {
  onAdd: (line: DraftLine) => void;
  onFile: (file: File) => void;
  /** Shown in the Stock Count screen's own red message line. */
  onError: (text: string) => void;
}): React.JSX.Element {
  const { onAdd, onFile, onError } = props;
  const [itemSearch, setItemSearch] = useState('');
  const [pickerKey, setPickerKey] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const [templateBusy, setTemplateBusy] = useState(false);
  const downloadTemplate = async (): Promise<void> => {
    setTemplateBusy(true);
    try {
      await apiDownload(
        '/import-templates/stock-count.xlsx',
        {},
        'Stock Count Import Template.xlsx',
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not download the template. Try again.');
    } finally {
      setTemplateBusy(false);
    }
  };
  const { data: itemsData, isFetching } = useItemsList({
    search: itemSearch.trim() || undefined,
    limit: 50,
    offset: 0,
  });
  const itemOptions = useMemo(
    () => (itemsData?.items ?? []).map((it) => ({ id: it.id, code: it.code, name: it.name })),
    [itemsData],
  );
  const pick = (itemId: string | null): void => {
    const it = itemsData?.items.find((x) => x.id === itemId);
    if (it) {
      // Read the item's stock now, so In Stock / Difference show while
      // counting — not only after Save Draft (stock-count-create#1).
      void resolveStockCountItems([it.code])
        .then((r) => r.found.find((f) => f.itemId === it.id)?.inStock ?? null)
        .catch(() => null)
        .then((inStock) =>
          onAdd({
            itemId: it.id,
            itemCode: it.code,
            itemName: it.name,
            uom: it.uom,
            inStock,
            countedQty: '',
            reason: '',
          }),
        );
    }
    // Remount the picker so the next item can be keyed straight in.
    setPickerKey((k) => k + 1);
  };
  return (
    <div
      className="panel-body"
      style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
    >
      <div style={{ minWidth: 320 }}>
        <SearchableSelect
          key={pickerKey}
          id="sc-item"
          value={null}
          onChange={pick}
          options={itemOptions}
          onSearch={setItemSearch}
          loading={isFetching}
          placeholder="🔍 Add item — type code or name…"
          emptyText="No matching item"
        />
      </div>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => fileRef.current?.click()}
      >
        <Upload size={13} /> Upload Excel
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={templateBusy}
        onClick={() => void downloadTemplate()}
      >
        <Download size={13} /> {templateBusy ? 'Preparing…' : 'Excel Template'}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
