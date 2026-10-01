// Per-row ⬇ Excel action for the Job Cards list. Like PrintJcButton, it lazily
// fetches the JC's enriched ops + full op_log on first click, then exports the
// 3-sheet workbook (Job Card / Operations / Production Log — WITH the log).
import type { JobCardListItem } from '@innovic/shared';
import { Download, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useJcOpsEnriched, useOpLog } from '@/modules/op-entry/api';
import { exportJobCardExcel } from '../lib/export-job-card-excel';

/**
 * The Excel click logic, shared by the card view's button and the sheet's ⋯
 * menu item. `start()` arms the lazy fetch and exports once the data is in;
 * its Promise settles when the export has run (or failed), so the ⋯ menu
 * shows busy and cannot start a second download meanwhile.
 */
export function useExcelJc(jc: JobCardListItem): {
  start: () => Promise<void>;
  loading: boolean;
} {
  const [armed, setArmed] = useState(false);
  const [pending, setPending] = useState(false);
  const doneRef = useRef(false);
  const waitRef = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null);
  const settle = useCallback((): void => {
    waitRef.current?.resolve();
    waitRef.current = null;
  }, []);
  // A row that unmounts mid-fetch must not leave the ⋯ busy for ever.
  useEffect(() => settle, [settle]);

  const opsQuery = useJcOpsEnriched({ jobCardId: jc.id }, { enabled: armed });
  const logsQuery = useOpLog({ jobCardId: jc.id, limit: 500 }, { enabled: armed });

  useEffect(() => {
    if (!pending || doneRef.current) return;
    if (opsQuery.isError || logsQuery.isError) {
      setPending(false);
      settle();
      window.alert('Could not load Job Card data for export. Try again.');
      return;
    }
    if (!opsQuery.data || opsQuery.isFetching || logsQuery.isFetching) return;
    doneRef.current = true;
    setPending(false);
    settle();
    exportJobCardExcel({ jc, ops: opsQuery.data, logs: logsQuery.data ?? [] });
  }, [
    pending,
    opsQuery.data,
    opsQuery.isError,
    opsQuery.isFetching,
    logsQuery.data,
    logsQuery.isError,
    logsQuery.isFetching,
    jc,
    settle,
  ]);

  const start = useCallback((): Promise<void> => {
    if (waitRef.current) return waitRef.current.promise;
    let resolve: () => void = () => undefined;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    waitRef.current = { promise, resolve };
    doneRef.current = false;
    setArmed(true);
    setPending(true);
    return promise;
  }, []);

  return { start, loading: pending && (opsQuery.isFetching || logsQuery.isFetching) };
}

export function ExcelJcButton({
  jc,
  iconOnly = false,
}: {
  jc: JobCardListItem;
  /** The list sheet's Action column: icon alone, the title names the action. */
  iconOnly?: boolean | undefined;
}): React.JSX.Element {
  const { start, loading } = useExcelJc(jc);

  const onClick = (e: React.MouseEvent): void => {
    e.stopPropagation();
    void start();
  };
  const icon = loading ? (
    <Loader2 size={13} className="inline animate-spin" />
  ) : (
    <Download size={13} />
  );

  if (iconOnly) {
    return (
      <button
        type="button"
        className="btn btn-ghost btn-sm btn-icon"
        onClick={onClick}
        disabled={loading}
        title="Download Excel"
        aria-label="Download Excel"
        style={{ padding: '2px 3px' }}
      >
        {icon}
      </button>
    );
  }

  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={onClick}
      disabled={loading}
      title="Download Excel (with production log)"
      style={{ whiteSpace: 'nowrap' }}
    >
      {icon} Excel
    </button>
  );
}
