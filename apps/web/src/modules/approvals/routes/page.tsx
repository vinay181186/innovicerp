// Settings → Approvals (ADR-265) — the things waiting for my decision, and the
// decisions already made.
//
// Distinct from Approval Rules next to it in the menu, which holds the rules
// (which approvals are on, who may approve, the PO limit). This screen holds
// the queue.
//
// ONE list, the same one the home Approvals view shows (ApprovalsList): only
// the types with something waiting, decided in place. The Show select picks
// Waiting (that list) or the Approved / Rejected history (ApprovalHistoryList).

import { APPROVAL_DECISIONS, type ApprovalDecision } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { authenticatedRoute } from '@/routes/_authenticated';
import { ApprovalHistoryList } from '../components/approval-history-list';
import { ApprovalsList } from '../components/approvals-list';

export const approvalsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'approvals',
  component: ApprovalsPage,
});

type ShowValue = 'waiting' | ApprovalDecision;

const SHOW_OPTIONS: Array<{ value: ShowValue; label: string }> = [
  { value: 'waiting', label: 'Waiting' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

function isDecision(v: ShowValue): v is ApprovalDecision {
  return (APPROVAL_DECISIONS as readonly string[]).includes(v);
}

function ApprovalsPage(): React.JSX.Element {
  const [show, setShow] = useState<ShowValue>('waiting');
  const showSelect = (
    <select
      className="innovic-select"
      aria-label="Show"
      title="Show"
      value={show}
      onChange={(e) => setShow(e.target.value as ShowValue)}
    >
      {SHOW_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
  const reset = (): void => setShow('waiting');

  if (isDecision(show)) {
    // Keyed so Approved and Rejected each start on page 1 with no search.
    return (
      <ApprovalHistoryList
        key={show}
        decision={show}
        showSelect={showSelect}
        onClearExtra={reset}
      />
    );
  }
  return <ApprovalsList showSelect={showSelect} />;
}
