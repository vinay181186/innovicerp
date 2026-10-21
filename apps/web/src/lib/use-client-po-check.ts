// ADR-245 — the live Client PO No. check on the SO and JWSO create/edit forms.
// Client PO No. is unique per CUSTOMER within its own list (SO list, JWSO list);
// a different customer may use the same number. This only WARNS while typing —
// the server's 409 at save is the real guard.
//
// Same shape as use-doc-number.ts: the typed value is debounced 500ms and the
// query key carries list + customer + the trimmed, lower-cased number + the
// order being edited, so an answer for old text (or the previous customer) is
// never shown against the new one. Changing the customer changes the key, so
// it re-checks at once.

import type { ClientPoCheckResponse } from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { useDebounce } from '@/lib/use-debounce';

export interface ClientPoCheckState {
  /** A check is pending (debounce not caught up, or the request in flight). */
  checking: boolean;
  /** The number is already on another live order of this customer. */
  duplicate: boolean;
  /** That order's number, when duplicate. */
  code: string | null;
  /** The check itself failed (network / server) — never blocks Save. */
  error: boolean;
}

const PATH = { so: '/sales-orders', jwso: '/job-work-orders' } as const;

export function useClientPoCheck(
  list: 'so' | 'jwso',
  clientId: string | null | undefined,
  poNo: string | null | undefined,
  excludeId?: string,
): ClientPoCheckState {
  const now = (poNo ?? '').trim().toLowerCase();
  const debounced = useDebounce(now, 500);
  const enabled = Boolean(clientId) && debounced !== '';

  const q = useQuery<ClientPoCheckResponse>({
    queryKey: ['client-po-check', list, clientId ?? null, debounced, excludeId ?? null],
    queryFn: () => {
      const params = new URLSearchParams({ clientId: clientId ?? '', clientPoNo: debounced });
      if (excludeId) params.set('excludeId', excludeId);
      return apiFetch<ClientPoCheckResponse>(`${PATH[list]}/client-po-check?${params.toString()}`);
    },
    enabled,
    staleTime: 0,
  });

  // Only trust an answer for the text that is in the box right now.
  const current = enabled && now === debounced;
  const duplicate = current && q.data?.taken === true;
  const checking = Boolean(clientId) && now !== '' && (now !== debounced || q.isFetching);

  return {
    checking,
    duplicate,
    code: duplicate ? (q.data?.code ?? null) : null,
    error: current && q.isError,
  };
}
