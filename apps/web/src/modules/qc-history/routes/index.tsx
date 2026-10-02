// QC History & Tracking (QC Wave 2). Ports legacy renderQCHistory (HTML
// L23531): All/Pending/Completed tabs + 4 stat cards + SO/JC/Item + date
// filters + pending QC table + completed QC-entries table + Excel export.
// Read-only, legacy chrome.

import { Link, createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, StatStrip } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ActionMenu, ListHeader } from '@/ui/layout';
import { useQcHistory } from '../api';
import {
  QC_HISTORY_DEFAULT_PINNED,
  qcEntryColumns,
  qcPendingColumns,
} from '../components/qc-history-columns';
import { exportCompletedQc, exportPendingQc } from '../lib/export';

export const qcHistoryRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'qc-history',
  component: QcHistoryPage,
});

type Tab = 'all' | 'pending' | 'completed';

// Legacy L23599-23601 tabs, now the Status dropdown in the filter bar.
const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'completed', label: 'Completed' },
];

function QcHistoryPage(): React.JSX.Element {
  const { data, isLoading, isFetching, isError, error } = useQcHistory();
  const [tab, setTab] = useState<Tab>('all');
  const [term, setTerm] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const pendingColumns = useMemo(() => qcPendingColumns(), []);
  const entryColumns = useMemo(() => qcEntryColumns(), []);

  const t = term.trim().toLowerCase();
  const matchText = (...vals: (string | null)[]): boolean =>
    t === '' || vals.some((v) => (v ?? '').toLowerCase().includes(t));

  const pending = useMemo(
    () =>
      (data?.pending ?? []).filter((o) =>
        // The revision is part of what the Item column shows, and the part name
        // now has a column of its own, so both have to be part of what the box
        // searches — an inspector hunting "plunger" should not have to know its
        // code. This filter runs over rows already in the browser, so nothing
        // can be hidden by widening it.
        matchText(o.soCode, o.jcCode, o.clientPoLineNo, o.itemCode, o.itemRevision, o.itemName),
      ),
    [data?.pending, t],
  );
  const logs = useMemo(
    () =>
      (data?.logs ?? []).filter(
        (l) =>
          // Same widening as the pending list: the Item Name column is on
          // screen, so typing a part name has to find the row.
          matchText(l.soCode, l.jcCode, l.clientPoLineNo, l.itemCode, l.itemRevision, l.itemName) &&
          (dateFrom === '' || l.logDate >= dateFrom) &&
          (dateTo === '' || l.logDate <= dateTo),
      ),
    [data?.logs, t, dateFrom, dateTo],
  );

  const showPend = tab === 'all' || tab === 'pending';
  const showComp = tab === 'all' || tab === 'completed';

  function clearFilters(): void {
    setTerm('');
    setDateFrom('');
    setDateTo('');
    setTab('all');
  }

  const shownCount = (showPend ? pending.length : 0) + (showComp ? logs.length : 0);
  // Row counts per status, over the searched / dated rows — the Status
  // dropdown's option labels (it replaced the All / Pending / Completed tabs).
  const tabCount: Record<Tab, number> = {
    all: pending.length + logs.length,
    pending: pending.length,
    completed: logs.length,
  };

  return (
    <div>
      <ListHeader
        title="QC History"
        icon="📊"
        count={data ? shownCount : undefined}
        noun="row"
        filterNote={tab === 'all' ? undefined : TABS.find((tb) => tb.key === tab)?.label}
        search={term}
        onSearch={setTerm}
        searchPlaceholder="Search SO, JC, POL, item code, item name…"
        updating={isFetching && !isLoading}
        filters={
          <>
            <select
              className="innovic-select"
              aria-label="QC status"
              title="QC status"
              value={tab}
              onChange={(e) => setTab(e.target.value as Tab)}
            >
              {TABS.map((tb) => (
                <option key={tb.key} value={tb.key}>
                  {`${tb.label} (${tabCount[tb.key]})`}
                </option>
              ))}
            </select>
            <input
              type="date"
              className="innovic-input"
              title="QC Date From"
              aria-label="QC Date From"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
            <input
              type="date"
              className="innovic-input"
              title="QC Date To"
              aria-label="QC Date To"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </>
        }
        onClearFilters={clearFilters}
        filtersActive={tab !== 'all' || term.trim() !== '' || dateFrom !== '' || dateTo !== ''}
        tools={
          <>
            <ActionMenu
              label="⬇ Export"
              items={[
                {
                  label: 'Completed Entries',
                  disabled: logs.length === 0,
                  onClick: () => exportCompletedQc(logs),
                },
                {
                  label: 'QC Pending',
                  disabled: pending.length === 0,
                  onClick: () => exportPendingQc(pending),
                },
              ]}
            />
          </>
        }
      >
        {data ? (
          /* Stats — legacy L23604-23609, now one strip under the title. */
          <StatStrip
            items={[
              {
                key: 'overdue',
                label: 'Overdue (more than 1 day)',
                count: data.stats.overdue,
                color: 'var(--red2)',
              },
              {
                key: 'today',
                label: "Today's Entries",
                count: data.stats.today,
                color: 'var(--blue)',
              },
            ]}
          />
        ) : null}
      </ListHeader>

      {isLoading ? (
        <div className="panel">
          <div className="empty-state">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading QC history…
          </div>
        </div>
      ) : isError || !data ? (
        <div className="panel">
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'Could not load QC History. Try again.'}
          </div>
        </div>
      ) : (
        <>
          {showPend ? (
            <div className="panel" style={{ marginBottom: 14 }}>
              <div className="panel-hdr">
                <span className="panel-title" style={{ color: 'var(--amber2)' }}>
                  ⏳ QC Pending ({pending.length})
                </span>
              </div>
              <DataTable
                tableKey={TABLE_KEYS.qcHistoryPending}
                columns={pendingColumns}
                rows={pending}
                rowKey={(o) => o.jcOpId}
                rowClassName={(o) => (o.overdue ? 'qc-alert-blink' : undefined)}
                emptyText={t ? 'Nothing QC Pending matches.' : 'Nothing QC Pending.'}
                defaultPinned={QC_HISTORY_DEFAULT_PINNED}
                rowMenu={() => [
                  {
                    key: 'open-qc',
                    label: 'Open QC',
                    icon: 'search',
                    group: 'workflow',
                    to: '/qc-call-register',
                  },
                ]}
                renderLink={(p) => <Link {...p} />}
              />
            </div>
          ) : null}

          {showComp ? (
            <div className="panel">
              <div className="panel-hdr">
                <span className="panel-title" style={{ color: 'var(--green2)' }}>
                  ✅ QC Entries ({logs.length})
                </span>
              </div>
              <DataTable
                tableKey={TABLE_KEYS.qcHistoryEntries}
                columns={entryColumns}
                rows={logs}
                sortFilter={false}
                rowKey={(l) => l.logId}
                emptyText={t || dateFrom || dateTo ? 'No QC entries match.' : 'No QC entries yet.'}
                defaultPinned={QC_HISTORY_DEFAULT_PINNED}
              />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
