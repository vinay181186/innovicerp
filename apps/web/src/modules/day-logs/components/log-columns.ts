// Log Date · Log Time: when a Day Log entry was FIRST saved, in IST (an edit
// never moves it). One pair for My Day Log and the person page. The ▾ reads the
// real values: a Date is taken as its India-time day, the time as 24-hour.

import { parseTime } from '@innovic/shared';
import type { DataTableColumn } from '@/ui/data';
import { istStamp } from '../lib/format';

export function logColumns<T extends { loggedAt: string }>(): DataTableColumn<T>[] {
  return [
    {
      id: 'logDate',
      header: 'Log Date',
      kind: 'date',
      className: 'mono',
      render: (r) => istStamp(r.loggedAt).date,
      filterValue: (r) => new Date(r.loggedAt),
    },
    {
      id: 'logTime',
      header: 'Log Time',
      kind: 'date',
      className: 'mono',
      render: (r) => istStamp(r.loggedAt).time,
      filterValue: (r) => parseTime(istStamp(r.loggedAt).time),
    },
  ];
}
