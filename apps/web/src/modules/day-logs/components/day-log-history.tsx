// Team Day Logs › row ⋯ › History (ADR-278, owner 2026-11-06, Super Admin only):
// pick a Month or a Particular Date, see the server's count line, Generate PDF
// opens the Preview box (Print, Download) above this pop-up. Every count and
// every "nothing to print" answer comes from the server's reply.

import type { Company, DayLogHistory, DayLogHistoryQuery } from '@innovic/shared';
import { fmtDuration } from '@innovic/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { fmtDate } from '@/lib/date';
import { runPrint } from '@/lib/print/preview-host';
import { companyKeys } from '@/modules/settings/api';
import { Banner, Modal } from '@/ui/feedback';
import { FormField, Input } from '@/ui/forms';
import { dayLogHistoryQuery, useDayLogHistory } from '../api';
import { errText, monthLabel, weekdayName } from '../lib/format';
import { printDayLogHistory } from '../lib/print-day-log-history';

type Mode = 'month' | 'date';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Why there is nothing to print, in the words the Generate button stands behind. */
function nothingReason(h: DayLogHistory): string {
  if (h.month) return `No Day Log for ${h.userName} in ${monthLabel(h.month)}.`;
  const date = fmtDate(h.date);
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

function CountLine({ history }: { history: DayLogHistory }): React.JSX.Element {
  const t = history.totals;
  const day = history.days[0];
  if (history.month || !day) {
    return (
      <div className="dl-sum" role="status">
        <Fact label="Filled days" value={t.filledDays} />
        <Fact label="Not entered" value={t.notEntered} />
        <Fact label="Entries" value={t.entries} />
        <Fact label="Working hours" value={fmtDuration(t.workMin)} />
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
          <Fact label="Working hours" value={fmtDuration(t.workMin)} />
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
  const thisMonth = today.slice(0, 7);
  const [mode, setMode] = useState<Mode>('month');
  const [month, setMonth] = useState(thisMonth);
  const [date, setDate] = useState(today);
  const qc = useQueryClient();

  const isMonth = mode === 'month';
  const picked = isMonth ? month : date;
  const pickError = isMonth
    ? !MONTH_RE.test(month)
      ? 'Pick a month.'
      : month > thisMonth
        ? 'A future month has no Day Log.'
        : null
    : !DATE_RE.test(date)
      ? 'Pick a date.'
      : date > today
        ? 'A date after today has no Day Log.'
        : null;
  const q: DayLogHistoryQuery = isMonth ? { userId, month } : { userId, date };
  const history = useDayLogHistory(q, pickError === null);
  const data = pickError === null ? history.data : undefined;
  const reason = pickError ?? (data && !data.hasContent ? nothingReason(data) : null);
  const canGenerate = pickError === null && data?.hasContent === true && !history.isFetching;

  const generate = (): void => {
    void runPrint(
      'preview',
      { title: 'History', fileName: `Day Log History ${userName} ${picked}` },
      async () => {
        // Read again at the click: the PDF is never older than the click.
        const [fresh, company] = await Promise.all([
          qc.fetchQuery(dayLogHistoryQuery(q)),
          qc.fetchQuery({
            queryKey: companyKeys.me(),
            queryFn: () => apiFetch<Company>('/companies/me'),
          }),
        ]);
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
        role="radiogroup"
        aria-label="History period"
        style={{ display: 'flex', gap: 'var(--sp-4)', marginBottom: 'var(--sp-3)' }}
      >
        {(
          [
            ['month', 'Month'],
            ['date', 'Particular Date'],
          ] as const
        ).map(([value, label]) => (
          <label
            key={value}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-1)' }}
          >
            <input
              type="radio"
              name="dl-history-mode"
              value={value}
              checked={mode === value}
              onChange={() => setMode(value)}
            />
            {label}
          </label>
        ))}
      </div>
      {isMonth ? (
        <FormField label="Select Month" htmlFor="dl-history-month" required>
          <Input
            id="dl-history-month"
            type="month"
            mono
            fieldWidth="md"
            max={thisMonth}
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </FormField>
      ) : (
        <FormField label="Select Date" htmlFor="dl-history-date" required>
          <Input
            id="dl-history-date"
            type="date"
            mono
            fieldWidth="md"
            max={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </FormField>
      )}
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
