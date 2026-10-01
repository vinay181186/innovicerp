// The Job Cards list filter bar (ADR-199 split-out of routes/list.tsx to keep
// that file under the 400-line cap). JUST the filter controls that sit in the
// <ListHeader>'s `filters` slot: JC Status (with Overdue and the counts in the
// labels), Machine, Operator and the two JC Date inputs. The search box, the
// Clear button and the create buttons stay on the page — ListHeader owns them.

import { JC_COMPUTED_STATUSES, type JcComputedStatus } from '@innovic/shared';
import { Input, Select } from '@/ui/forms';
import { JC_STATUS_LABEL } from './jc-status-badge';

/** A machine / operator option as the list already maps it. */
interface CodeNameOption {
  id: string;
  code: string;
  name: string;
}

/** Counts shown in the JC Status dropdown labels (over the loaded set). */
export interface JcStatusCounts {
  all: number;
  byStatus: Record<JcComputedStatus, number>;
  overdue: number;
}

/** The subset of the list's search params the filter bar drives. */
export interface JcListFilterNav {
  status?: JcComputedStatus | undefined;
  overdue?: boolean | undefined;
  machineId?: string | undefined;
  operatorId?: string | undefined;
  fromDate?: string | undefined;
  toDate?: string | undefined;
}

interface JcListFiltersProps {
  status: JcComputedStatus | undefined;
  overdue: boolean | undefined;
  machineId: string | undefined;
  operatorId: string | undefined;
  fromDate: string | undefined;
  toDate: string | undefined;
  machines: CodeNameOption[];
  operators: CodeNameOption[];
  statusCounts: JcStatusCounts;
  countsReady: boolean;
  setNav: (update: JcListFilterNav) => void;
}

export function JcListFilters({
  status,
  overdue,
  machineId,
  operatorId,
  fromDate,
  toDate,
  machines,
  operators,
  statusCounts,
  countsReady,
  setNav,
}: JcListFiltersProps): React.JSX.Element {
  return (
    <>
      <Select
        aria-label="JC Status"
        value={overdue ? 'overdue' : (status ?? '')}
        options={[
          {
            value: '',
            label: countsReady ? `All statuses (${statusCounts.all})` : 'All statuses',
          },
          ...JC_COMPUTED_STATUSES.map((s) => ({
            value: s,
            label: countsReady
              ? `${JC_STATUS_LABEL[s]} (${statusCounts.byStatus[s]})`
              : JC_STATUS_LABEL[s],
          })),
          {
            value: 'overdue',
            label: countsReady ? `Overdue (${statusCounts.overdue})` : 'Overdue',
          },
        ]}
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'overdue') setNav({ status: undefined, overdue: true });
          else
            setNav({
              status: v === '' ? undefined : (v as JcComputedStatus),
              overdue: undefined,
            });
        }}
      />
      <Select
        aria-label="Machine"
        value={machineId ?? ''}
        options={[
          { value: '', label: 'All machines' },
          ...machines.map((m) => ({ value: m.id, label: `${m.code} — ${m.name}` })),
        ]}
        onChange={(e) => setNav({ machineId: e.target.value === '' ? undefined : e.target.value })}
      />
      <Select
        aria-label="Operator"
        value={operatorId ?? ''}
        options={[
          { value: '', label: 'All operators' },
          ...operators.map((o) => ({ value: o.id, label: `${o.code} — ${o.name}` })),
        ]}
        onChange={(e) => setNav({ operatorId: e.target.value === '' ? undefined : e.target.value })}
      />
      <Input
        type="date"
        value={fromDate ?? ''}
        onChange={(e) => setNav({ fromDate: e.target.value || undefined })}
        title="JC Date from"
        aria-label="JC Date from"
      />
      <Input
        type="date"
        value={toDate ?? ''}
        onChange={(e) => setNav({ toDate: e.target.value || undefined })}
        title="JC Date to"
        aria-label="JC Date to"
      />
    </>
  );
}
