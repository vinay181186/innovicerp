// Stock Count add-item bar (ADR-193 phase 2): type-to-search item picker,
// Excel upload and template download.
import { Download, Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useItemsList } from '@/modules/items/api';
import { SearchableSelect } from '@/ui/forms';
import type { DraftLine } from '../lib/draft-line';
import { downloadStockCountTemplate } from '../lib/excel';

export function StockCountAddBar(props: {
  onAdd: (line: DraftLine) => void;
  onFile: (file: File) => void;
}): React.JSX.Element {
  const { onAdd, onFile } = props;
  const [itemSearch, setItemSearch] = useState('');
  const [pickerKey, setPickerKey] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
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
      onAdd({
        itemId: it.id,
        itemCode: it.code,
        itemName: it.name,
        uom: it.uom,
        inStock: null,
        countedQty: '',
        reason: '',
      });
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
      <button type="button" className="btn btn-ghost btn-sm" onClick={downloadStockCountTemplate}>
        <Download size={13} /> Template
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
