// May a PO be raised from this Purchase Request right now? (ADR-189)
//
// A mirror of the server's `assertPrConvertible` (apps/api purchase-orders
// service) so a screen never offers "Create PO" for a PR the API will refuse:
//   - a Cancelled PR is never convertible;
//   - while PR approval is ON (approval_config.pr_approval), a PR still 'open'
//     (not yet approved) is refused — UNLESS the system raised it from a
//     job-card op (pr_type 'jw_osp' or a source JC op), which is exempt.
// When PR approval is OFF, today's behaviour stands.
//
// The switch comes from the Approval Configuration the web already fetches.
// Until it has loaded, and for a company with no config row, it reads as ON —
// the same default the server applies (column default true).

import { useApprovalConfig } from '@/modules/approval-config/api';

interface PrConvertSource {
  status: string;
  prType?: string | null | undefined;
  sourceJcOpId?: string | null | undefined;
}

/** True when PR approval is switched on for this company (default ON). */
export function usePrApprovalOn(): boolean {
  const { data } = useApprovalConfig();
  return data?.prApproval ?? true;
}

/** True when the PR is only held back because it still needs approving. */
export function prAwaitsApproval(pr: PrConvertSource, prApprovalOn: boolean): boolean {
  const machineRaised = pr.prType === 'jw_osp' || Boolean(pr.sourceJcOpId);
  return prApprovalOn && pr.status === 'open' && !machineRaised;
}

/** True when the server would accept a PO raised from this PR (status-wise;
 *  the quantity-left check is the caller's, via `prOrderBalance`). */
export function prConvertible(pr: PrConvertSource, prApprovalOn: boolean): boolean {
  return pr.status !== 'cancelled' && !prAwaitsApproval(pr, prApprovalOn);
}
