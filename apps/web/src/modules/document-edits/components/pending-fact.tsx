// One read-only fact of a record detail page: a ClusterFact that draws `—` for a
// blank value and the amber "→ after" chip (ADR-202) when an edit to that field
// is staged. `field` takes several keys for a value fed by two columns (State
// shows the State Code's label, so it watches both stateCode and state).

import type { DocumentEditChange } from '@innovic/shared';
import { ClusterFact, type ClusterFactProps } from '@/ui/forms';
import { PendingChangeChip, headerPendingChange } from './pending-change-chip';

export function PendingFact({
  changes,
  field,
  value,
  title,
  ...fact
}: Omit<ClusterFactProps, 'value' | 'after' | 'empty'> & {
  changes: readonly DocumentEditChange[];
  field: string | readonly string[];
  value: React.ReactNode;
}): React.JSX.Element {
  const fields = typeof field === 'string' ? [field] : field;
  const change = fields.map((f) => headerPendingChange(changes, f)).find(Boolean);
  const blank = value == null || value === '';
  return (
    <ClusterFact
      {...fact}
      empty={blank}
      value={blank ? '—' : value}
      // A one-line cell may ellipsis a long name; the full text stays on hover.
      title={title ?? (typeof value === 'string' ? value : undefined)}
      after={change ? <PendingChangeChip after={change.after} /> : undefined}
    />
  );
}
