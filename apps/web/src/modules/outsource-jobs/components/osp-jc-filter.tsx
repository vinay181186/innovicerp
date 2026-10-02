// Outsource Jobs — the JC No. filter (ADR-201). The tab is paged on the server,
// so the old dropdown (built from every OSP request in the browser) became a
// type-to-search box: typing searches the OSP requests on the server and offers
// the Job Card numbers found; the pick is sent as `sourceJcCode`.

import { useMemo, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { usePurchaseRequestsList } from '@/modules/purchase-requests/api';

export function OspJcFilter({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (jcCode: string | undefined) => void;
}): React.JSX.Element {
  const [term, setTerm] = useState('');
  const { data, isFetching } = usePurchaseRequestsList({
    prType: 'jw_osp',
    ...(term.trim() ? { search: term.trim() } : {}),
    limit: 50,
    offset: 0,
  });
  const options = useMemo(() => {
    const t = term.trim().toLowerCase();
    const codes = new Set<string>();
    for (const pr of data?.items ?? []) {
      if (pr.sourceJcCode && pr.sourceJcCode.toLowerCase().includes(t)) codes.add(pr.sourceJcCode);
    }
    return [...codes].sort().map((c) => ({ id: c, name: c }));
  }, [data?.items, term]);

  return (
    <div style={{ minWidth: 190 }}>
      <SearchableSelect
        id="osp-jc-filter"
        value={value ?? null}
        onChange={(id) => onChange(id ?? undefined)}
        onSearch={setTerm}
        loading={isFetching}
        options={options}
        placeholder="🔍 All JC Nos."
        valueLabel={value}
        emptyText="No JC with OSP requests matches."
      />
    </div>
  );
}
