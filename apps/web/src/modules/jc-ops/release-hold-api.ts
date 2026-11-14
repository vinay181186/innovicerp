// ADR-291 — release the hold an Engineering Change (or a not-released Drawing
// Rev) put on Job Card operations. POST /jc-ops/release-hold. Its own file so
// the op-entry / job-cards key factories can be imported without a cycle
// (op-entry/api.ts already imports jc-ops/api.ts).
import type { ReleaseHoldInput } from '@innovic/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { flowViewsKeys } from '@/modules/flow-views/api';
import { jobCardsKeys } from '@/modules/job-cards/api';
import { opEntryKeys } from '@/modules/op-entry/api';
import { jcOpsBoardKeys } from './api';

export function useReleaseOpHold() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, ReleaseHoldInput>({
    mutationFn: (input) => apiFetch('/jc-ops/release-hold', { method: 'POST', json: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jobCardsKeys.all });
      void qc.invalidateQueries({ queryKey: jcOpsBoardKeys.all });
      void qc.invalidateQueries({ queryKey: opEntryKeys.all });
      void qc.invalidateQueries({ queryKey: flowViewsKeys.all });
    },
  });
}
