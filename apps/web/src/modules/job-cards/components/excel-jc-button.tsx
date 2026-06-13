// Per-row ⬇ Excel action for the Job Cards list. Like PrintJcButton, it lazily
// fetches the JC's enriched ops + full op_log on first click, then exports the
// 3-sheet workbook (Job Card / Operations / Production Log — WITH the log).
import type { JobCardListItem } from '@innovic/shared';
import { Download, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useJcOpsEnriched, useOpLog } from '@/modules/op-entry/api';
import { exportJobCardExcel } from '../lib/export-job-card-excel';

export function ExcelJcButton({ jc }: { jc: JobCardListItem }): React.JSX.Element {
  const [armed, setArmed] = useState(false);
  const [pending, setPending] = useState(false);
  const doneRef = useRef(false);

  const opsQuery = useJcOpsEnriched({ jobCardId: jc.id }, { enabled: armed });
  const logsQuery = useOpLog({ jobCardId: jc.id, limit: 500 }, { enabled: armed });

  useEffect(() => {
    if (!pending || doneRef.current) return;
    if (opsQuery.isError || logsQuery.isError) {
      setPending(false);
      window.alert('Could not load job card data for export.');
      return;
    }
    if (!opsQuery.data || opsQuery.isFetching || logsQuery.isFetching) return;
    doneRef.current = true;
    setPending(false);
    exportJobCardExcel({ jc, ops: opsQuery.data, logs: logsQuery.data ?? [] });
  }, [pending, opsQuery.data, opsQuery.isError, opsQuery.isFetching, logsQuery.data, logsQuery.isError, logsQuery.isFetching, jc]);

  const loading = pending && (opsQuery.isFetching || logsQuery.isFetching);

  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={(e) => {
        e.stopPropagation();
        doneRef.current = false;
        setArmed(true);
        setPending(true);
      }}
      disabled={loading}
      title="Download Excel (with production log)"
      style={{ whiteSpace: 'nowrap' }}
    >
      {loading ? <Loader2 size={13} className="inline animate-spin" /> : <Download size={13} />} Excel
    </button>
  );
}
