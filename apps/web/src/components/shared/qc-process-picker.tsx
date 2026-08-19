// <QcProcessPicker> — the ONE QC-process field. Every screen that names a QC
// step (Job Card ops today, Route Cards next) renders this, so a fix to how QC
// processes are found lands everywhere at once.
//
// WAS: a plain text box. You typed the QC stage name by hand, and the only
// check was "not empty" (build-jc-write-input.ts / job-cards service.ts). The
// QC Process master existed and its own shared schema said it was "used by
// Route Cards + Job Cards to populate the QC op dropdowns" — but nothing in
// job-cards ever imported it. So "DIR", "dir" and "D.I.R" were all equally
// acceptable, and QC Command's First-Pass Yield report groups by that raw
// string (qc-command/service.ts) — three spellings would have read as three
// different QC stages with three separate yield percentages.
//
// NOW: <SearchableSelect> over the master, server-searched via ?search=.
//
// WHAT IT STILL STORES: the process NAME (the master's `code`), not its id.
// There is no `qc_process_id` column on jc_ops / plan_ops / route_card_ops —
// the step is a text column, and changing that is a schema migration this
// component deliberately does not require. So the picker resolves name → id to
// drive the dropdown and maps the picked id back to a name on the way out. The
// saved payload shape is byte-for-byte what the text box produced.
//
// WHY `valueLabel` matters here: a document may already hold a name that is not
// in the master — an older free-typed value, or one whose master row was set
// Inactive since. SearchableSelect resolves such a value to a null id, but
// `valueLabel` keeps the stored text on screen, so an existing QC step never
// silently reads as blank. Typing cannot overwrite it either: SearchableSelect
// only clears the selection when one is resolved, so an unrecognised name stays
// exactly as stored until someone deliberately picks a replacement.
//
// Only ACTIVE processes are offered. Inactive is the documented way to retire a
// QC stage without breaking the documents that already reference it — deleting
// one that is in use is refused by the server (qc-processes/service.ts).

import { useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { useQcProcessesList } from '@/modules/qc-processes/api';

export interface QcProcessPickerProps {
  /** DOM id for the input, so a caller's <label htmlFor> still points at it. */
  id?: string | undefined;
  /** The stored QC process NAME (`qc_processes.code`), or '' when unset. */
  value: string;
  /** Picked process name, or '' when cleared. */
  onChange: (code: string) => void;
  disabled?: boolean | undefined;
  className?: string | undefined;
  placeholder?: string | undefined;
}

export function QcProcessPicker({
  id,
  value,
  onChange,
  disabled,
  className,
  placeholder = '🔍 QC process ★',
}: QcProcessPickerProps): React.JSX.Element {
  const [search, setSearch] = useState('');
  const { data, isFetching } = useQcProcessesList({
    ...(search.trim() ? { search: search.trim() } : {}),
    isActive: true,
    limit: 50,
    offset: 0,
  });
  const items = data?.items ?? [];

  return (
    <SearchableSelect
      id={id}
      value={items.find((p) => p.code === value)?.id ?? null}
      onChange={(pickedId) =>
        onChange(pickedId ? (items.find((p) => p.id === pickedId)?.code ?? '') : '')
      }
      onSearch={setSearch}
      loading={isFetching}
      // A process with no description carries its name in `name` and no `code`,
      // so SearchableSelect renders a clean "DIR" instead of a dangling "DIR — ".
      options={items.map((p) =>
        p.description
          ? { id: p.id, code: p.code, name: p.description }
          : { id: p.id, name: p.code },
      )}
      selectedLabel={(o) => o.code ?? o.name}
      valueLabel={value || undefined}
      placeholder={placeholder}
      emptyText="No active QC processes — add one in the QC Process master"
      disabled={disabled}
      className={className}
    />
  );
}
