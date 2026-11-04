// The Job Cards list filter bar (ADR-199 split-out of routes/list.tsx to keep
// that file under the 400-line cap). JUST the filter controls that sit in the
// <ListHeader>'s `filters` slot: JC Status (with Overdue and the counts in the
// labels), Machine, Operator and the two JC Date inputs. The search box, the
// Clear button and the create buttons stay on the page — ListHeader owns them.

import { JC_COMPUTED_STATUSES, type JcComputedStatus } from '@innovic/shared';
import { Input, SearchableSelect, Select } from '@/ui/forms';
import { JC_STATUS_LABEL } from './jc-status-badge';

/** A machine / operator option as the list already maps it. */
interface CodeNameOption {
  id: string;
  code: string;
  name: string;
}

/** Counts shown in the JC Status dropdown labels (server-counted, ADR-201). */
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

function codeNameLabel(options: CodeNameOption[], id: string | undefined): string | undefined {
  const o = id ? options.find((x) => x.id === id) : undefined;
  return o ? `${o.code} — ${o.name}` : undefined;
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
      <SearchableSelect
        style={{ minWidth: 170 }}
        ariaLabel="Machine"
        value={machineId ?? null}
        options={machines}
        valueLabel={codeNameLabel(machines, machineId)}
        placeholder="All machines"
        clearable
        onChange={(id) => setNav({ machineId: id ?? undefined })}
      />
      <SearchableSelect
        style={{ minWidth: 170 }}
        ariaLabel="Operator"
        value={operatorId ?? null}
        options={operators}
        valueLabel={codeNameLabel(operators, operatorId)}
        placeholder="All operators"
        clearable
        onChange={(id) => setNav({ operatorId: id ?? undefined })}
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
