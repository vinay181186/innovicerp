// Per-row 🖨 Print action for the Job Cards list (Print Templates P3, ADR-034).
//
// The Job Card print needs the JC's enriched ops, which are NOT on the list row
// — they come from `/op-entry/jc-ops?jobCardId=…`. To avoid fetching ops for
// every row up-front, this button lazily enables that query on first click,
// then fires the print once both ops + company are loaded.
//
// Mirrors the route-card Print precedent (route-cards/routes/detail.tsx) but
// wrapped as a list-row action that fetches its data on demand.

import type { JobCardListItem } from '@innovic/shared';
import { Loader2, Printer } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useJcOpsEnriched, useOpLog } from '@/modules/op-entry/api';
import { useMyCompany } from '@/modules/settings/api';
import { printJobCard } from '../lib/print-job-card';

export function PrintJcButton({ jc }: { jc: JobCardListItem }): React.JSX.Element {
  // `armed` gates the on-demand ops fetch; `pending` means "print as soon as
  // the ops query resolves". A ref guards against printing twice if the query
  // re-settles.
  const [armed, setArmed] = useState(false);
  const [pending, setPending] = useState(false);
  const printedRef = useRef(false);

  const { data: company } = useMyCompany();
  const opsQuery = useJcOpsEnriched({ jobCardId: jc.id }, { enabled: armed });
  const logsQuery = useOpLog({ jobCardId: jc.id, limit: 200 }, { enabled: armed });

  useEffect(() => {
    if (!pending || printedRef.current) return;
    if (opsQuery.isError) {
      setPending(false);
      window.alert(
        opsQuery.error instanceof Error
          ? `Could not load operations: ${opsQuery.error.message}`
          : 'Could not load operations for this Job Card.',
      );
      return;
    }
    if (!opsQuery.data || logsQuery.isFetching) return; // still loading
    printedRef.current = true;
    setPending(false);
    const ok = printJobCard({ jc, ops: opsQuery.data, logs: logsQuery.data ?? [], company });
    if (!ok) window.alert('Allow popups to print.');
  }, [pending, opsQuery.data, opsQuery.isError, opsQuery.error, logsQuery.data, logsQuery.isFetching, jc, company]);

  const onClick = (e: React.MouseEvent): void => {
    e.stopPropagation();
    printedRef.current = false;
    setArmed(true);
    setPending(true);
  };

  const loading = pending && opsQuery.isFetching;

  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={onClick}
      disabled={loading}
      title="Print Job Card"
      style={{ whiteSpace: 'nowrap' }}
    >
      {loading ? (
        <Loader2 size={13} className="inline animate-spin" />
      ) : (
        <Printer size={13} />
      )}{' '}
      Print
    </button>
  );
}
