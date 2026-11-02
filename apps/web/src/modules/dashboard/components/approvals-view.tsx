// ADR-265 — Approvals on the home: THE one list of everything waiting for my
// decision (modules/approvals ApprovalsList), the same list Settings →
// Approvals shows, decided in place.

import { ApprovalsList } from '@/modules/approvals/components/approvals-list';

export function ApprovalsView(): React.JSX.Element {
  return <ApprovalsList sticky={false} />;
}
