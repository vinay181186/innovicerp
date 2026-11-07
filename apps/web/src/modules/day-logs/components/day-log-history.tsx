// Team Day Logs › row ⋯ › History (ADR-278, owner 2026-11-06, Super Admin only):
// pick From Date and To Date, see the server's count line, Generate PDF
// opens the Preview box (Print, Download) above this pop-up. Every count and
// every "nothing to print" answer comes from the server's reply.

import type { Company, DayLogHistory, DayLogHistoryQuery } from '@innovic/shared';
import { dayLogHistoryRangeError, fmtDuration } from '@innovic/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useDebounce } from '@/lib/use-debounce';
import { fmtDate } from '@/lib/date';
import { runPrint } from '@/lib/print/preview-host';
import { companyKeys } from '@/modules/settings/api';
import { Banner, Modal } from '@/ui/feedback';
import { FormField, Input } from '@/ui/forms';
import { dayLogHistoryQuery, useDayLogHistory } from '../api';
import { errText, historyQuickRanges, weekdayName } from '../lib/format';
import { historyFileName, printDayLogHistory } from '../lib/print-day-log-history';

/** Why there is nothing to print, in the words the Generate button stands behind. */
function nothingReason(h: DayLogHistory): string {
  if (h.from !== h.to) {
    return `No Day Log for ${h.userName} from ${fmtDate(h.from)} to ${fmtDate(h.to)}.`;
  }
  const date = fmtDate(h.from);
  const day = h.days[0];
  if (day?.state === 'sunday') return `${date} is a Sunday. Nothing logged.`;
  if (day?.state === 'holiday') {
    const name = day.holidayName ? ` (${day.holidayName})` : '';
    return `${date} is a holiday${name}. Nothing logged.`;
  }
  return `Nothing logged on ${date}.`;
}

function Fact({ label, value }: { label: string; value: string | number }): React.JSX.Element {
  return (
    <span>
      <span className="dl-k">{label}</span>
      <span className="dl-v">{value}</span>
    </span>
  );
}

const READ_DELAY_MS = 400;

function CountLine({ history }: { history: DayLogHistory }): React.JSX.Element {
  const t = history.totals;
  const day = history.days[0];
  if (history.from !== history.to || !day) {
    return (
      <div className="dl-sum" role="status">
        <Fact label="Total Entry Days" value={t.filledDays} />
        <Fact label="Not Entered" value={t.notEntered} />
        <Fact label="Entries" value={t.entries} />
        <Fact label="Total Working Hours" value={fmtDuration(t.workMin)} />
        <Fact label="Avg Daily Working Hours" value={fmtDuration(t.avgDailyWorkMin)} />
      </div>
    );
  }
  return (
    <div className="dl-sum" role="status">
      <span className="dl-v" style={{ marginLeft: 0 }}>
        {fmtDate(day.date)} · {weekdayName(day.date)}
      </span>
      {day.state === 'not_entered' ? (
        <span className="badge b-orange">Not entered</span>
      ) : (
        <>
          <Fact label="Entries" value={t.entries} />
          <Fact label="Working Hours" value={fmtDuration(t.workMin)} />
        </>
      )}
    </div>
  );
}

export function DayLogHistoryModal({
  userId,
  userName,
  deptLabel,
  today,
  onClose,
}: {
  userId: string;
  userName: string;
  deptLabel: string | null;
  /** The server's IST today (the pickers' max). */
  today: string;
  onClose: () => void;
}): React.JSX.Element {
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const qc = useQueryClient();

  const pickError = dayLogHistoryRangeError(from, to, today);
  // Typing a date passes through other valid dates: read only once it has settled.
  const [readFrom = from, readTo = to] = useDebounce(`${from}|${to}`, READ_DELAY_MS).split('|');
  const settled = readFrom === from && readTo === to;
  const q: DayLogHistoryQuery = { userId, from, to };
  const history = useDayLogHistory(
    { userId, from: readFrom, to: readTo },
    pickError === null && settled,
  );
  const data = pickError === null && settled ? history.data : undefined;
  const reason = pickError ?? (data && !data.hasContent ? nothingReason(data) : null);
  const canGenerate = pickError === null && data?.hasContent === true && !history.isFetching;

  const generate = (): void => {
    void runPrint(
      'preview',
      { title: 'History', fileName: historyFileName(userName, from, to) },
      async () => {
        // Read again at the click: the PDF is never older than the click.
        const [fresh, company] = await Promise.all([
          qc.fetchQuery(dayLogHistoryQuery(q)),
          qc.fetchQuery({
            queryKey: companyKeys.me(),
            queryFn: () => apiFetch<Company>('/companies/me'),
          }),
        ]);
        // Something may have gone since the screen last read; never an empty sheet.
        if (!fresh.hasContent) throw new Error(nothingReason(fresh));
        return () => printDayLogHistory(fresh, company);
      },
    );
  };

  return (
    <Modal
      title={`History · ${userName}${deptLabel ? ` · ${deptLabel}` : ''}`}
      onClose={onClose}
      confirmExit={false}
      maxWidth="480px"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canGenerate}
            title={reason ?? undefined}
            onClick={generate}
          >
            Generate PDF
          </button>
        </>
      }
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--sp-2)',
          marginBottom: 'var(--sp-3)',
        }}
      >
        {historyQuickRanges(today).map((r) => (
          <button
            key={r.label}
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setFrom(r.from);
              setTo(r.to);
            }}
          >
            {r.label}
          </button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-3)' }}>
        <FormField label="From Date" htmlFor="dl-history-from" required>
          <Input
            id="dl-history-from"
            type="date"
            mono
            fieldWidth="md"
            max={today}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </FormField>
        <FormField label="To Date" htmlFor="dl-history-to" required>
          <Input
            id="dl-history-to"
            type="date"
            mono
            fieldWidth="md"
            max={today}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </FormField>
      </div>
      <div style={{ marginTop: 'var(--sp-3)' }}>
        {history.isError && pickError === null ? (
          <Banner tone="error">{errText(history.error, 'Could not read the Day Log.')}</Banner>
        ) : null}
        {reason ? (
          <div className="text3" role="status">
            {reason}
          </div>
        ) : data ? (
          <CountLine history={data} />
        ) : !history.isError ? (
          <div className="text3">Loading…</div>
        ) : null}
      </div>
    </Modal>
  );
}
