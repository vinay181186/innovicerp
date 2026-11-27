// SO / JWSO status on one day (ADR-325): a row per SO, then a row per JWSO,
// each table with a Total row. The page scrolls as a whole; the column
// headings stay frozen under the page header (DataTable `pageStickyTop`).

import type { OrderStatusRow } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { addDaysLocal, todayIst } from '@/lib/date';
import { useMyCompany } from '@/modules/settings/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Badge, Icon } from '@/ui/core';
import { DataTable, EmptyState } from '@/ui/data';
import { ReportFilter, ReportShell } from '@/ui/data/ReportShell';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { useToast } from '@/ui/feedback';
import { PageState } from '@/ui/layout';
import { useSoJwsoDay } from '../api';
import { orderColumns } from '../components/columns';
import { DAYS_MODES } from '../lib/days';
import { dayTitle, exportDayExcel, printDay, sourceLine } from '../lib/export';
import '../so-jwso-status.css';

/** `from` is the kept range's From date, or `home` when the day was opened
 *  from the Home menu view (Back then returns to Home). */
const daySearchSchema = z.object({
  from: z.string().optional().catch(undefined),
  to: z.string().optional().catch(undefined),
  mode: z.enum(DAYS_MODES).optional().catch(undefined),
});

export const soJwsoDayRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'so-jwso-status/$date',
  validateSearch: daySearchSchema,
  component: SoJwsoDayPage,
});

/** Height of ReportShell's sticky header band — where the table headings stop. */
function useBandHeight(ref: React.RefObject<HTMLDivElement | null>): number {
  const [h, setH] = useState(0);
  useLayoutEffect(() => {
    const band = ref.current?.firstElementChild?.firstElementChild;
    if (!(band instanceof HTMLElement)) return;
    const read = (): void => setH(band.offsetHeight);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(band);
    return () => ro.disconnect();
  }, [ref]);
  return h;
}

function SoJwsoDayPage(): React.JSX.Element {
  const { date } = soJwsoDayRoute.useParams();
  const search = soJwsoDayRoute.useSearch();
  const navigate = soJwsoDayRoute.useNavigate();
  const toast = useToast();
  const { data: company } = useMyCompany();
  const q = useSoJwsoDay(date);
  const [exporting, setExporting] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const headTop = useBandHeight(rootRef);
  const soColumns = useMemo(() => orderColumns('SO No.'), []);
  const jwsoColumns = useMemo(() => orderColumns('JWSO No.'), []);

  const d = q.data;
  const today = d?.today ?? todayIst();
  const fromHome = search.from === 'home';

  const goBack = (): void => {
    if (fromHome) void navigate({ to: '/', search: { view: 'so-jwso-status' } });
    else
      void navigate({
        to: '/so-jwso-status',
        search: { from: search.from, to: search.to, mode: search.mode },
      });
  };
  const goDay = (next: string): void => {
    if (!next || next > today) return;
    void navigate({ to: '/so-jwso-status/$date', params: { date: next }, search });
  };
  const openOrder = (r: OrderStatusRow): void => {
    if (r.orderKind === 'SO') void navigate({ to: '/sales-orders/$id', params: { id: r.orderId } });
    else void navigate({ to: '/job-work-orders/$id', params: { id: r.orderId } });
  };

  const onExcel = async (): Promise<void> => {
    if (!d) return;
    setExporting(true);
    try {
      await exportDayExcel(d);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not make the Excel file.');
    } finally {
      setExporting(false);
    }
  };
  const onPrint = (): void => {
    if (d && !printDay(d, company)) toast.error('Allow popups to print.');
  };

  const hasRows = !!d && d.source !== 'none';
  const badge = d ? (
    <Badge tone={d.source === 'live' ? 'green' : d.source === 'saved' ? 'blue' : 'grey'}>
      {sourceLine(d)}
    </Badge>
  ) : null;

  let body: React.ReactNode;
  if (q.isLoading) body = <PageState state="loading" />;
  else if (q.isError || !d)
    body = (
      <PageState
        state="error"
        message={q.error instanceof Error ? q.error.message : 'Could not load this day. Try again.'}
      />
    );
  else if (d.source === 'none')
    body = (
      <EmptyState>
        No copy saved for this day — history starts the day this report went live.
      </EmptyState>
    );
  else
    body = (
      <>
        <div className="sjs-section">1. SO wise summary ({d.soRows.length})</div>
        <DataTable<OrderStatusRow>
          tableKey={TABLE_KEYS.soJwsoDaySo}
          columns={soColumns}
          rows={d.soRows}
          rowKey={(r) => r.orderId}
          pageStickyTop={headTop}
          showTotals
          totalsLabel="Total"
          emptyText="No SO on this day."
          onRowClick={openOrder}
        />
        <div className="sjs-section">2. JWSO wise summary ({d.jwsoRows.length})</div>
        <DataTable<OrderStatusRow>
          tableKey={TABLE_KEYS.soJwsoDayJwso}
          columns={jwsoColumns}
          rows={d.jwsoRows}
          rowKey={(r) => r.orderId}
          pageStickyTop={headTop}
          showTotals
          totalsLabel="Total"
          emptyText="No JWSO on this day."
          onRowClick={openOrder}
        />
      </>
    );

  return (
    <div ref={rootRef}>
      <ReportShell
        title={dayTitle(date)}
        icon="📅"
        backLabel={fromHome ? 'Back to Home' : 'Back to SO / JWSO Status'}
        onBack={goBack}
        actions={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void q.refetch()}
              disabled={q.isFetching}
            >
              <Icon name="refresh-cw" size={13} /> {q.isFetching ? 'Refreshing…' : 'Refresh'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onPrint} disabled={!hasRows}>
              <Icon name="printer" size={13} /> Print
            </button>
          </>
        }
        onExport={{ excel: () => void onExcel(), busy: exporting }}
        exportDisabled={!hasRows}
        filters={
          <div className="sjs-tools">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => goDay(addDaysLocal(date, -1))}
            >
              ‹ Previous day
            </button>
            <ReportFilter label="Date" htmlFor="sjs-day">
              <input
                id="sjs-day"
                type="date"
                className="innovic-input"
                value={date}
                max={today}
                onChange={(e) => goDay(e.target.value)}
              />
            </ReportFilter>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={date >= today}
              onClick={() => goDay(addDaysLocal(date, 1))}
            >
              Next day ›
            </button>
            {badge}
          </div>
        }
      >
        {body}
      </ReportShell>
    </div>
  );
}
