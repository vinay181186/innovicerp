// Document-number validation hook (Phase 1: SO / PO / GRN; reused for 12 more
// types in Phase 2). Given a document type and the field's current value it:
//   - fetches the suggested next code (for prefill),
//   - debounces the value 500ms and checks the backend for duplicates,
//   - detects format mismatches client-side (no backend call for those),
//   - returns a validation object + the auto-padded canonical value.
//
// Pure decision logic lives in @innovic/shared (evaluateDocNumber / docNumberError)
// and is unit-tested there; this hook only wires it to TanStack Query + debounce.

import {
  type CheckDocNumberResponse,
  type DocNumberType,
  docNumberError,
  evaluateDocNumber,
  type PoType,
} from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { useDebounce } from '@/lib/use-debounce';

export interface DocNumberState {
  /** Suggested next code (MAX+1) for prefill; undefined until loaded. */
  nextCode: string | undefined;
  /** True while the default/next code is loading. */
  defaultLoading: boolean;
  /** True while a duplicate check is pending (debounce or request in flight). */
  checking: boolean;
  /** The current value is already taken. */
  duplicate: boolean;
  /** The current value doesn't match the strict format. */
  formatInvalid: boolean;
  /** Safe to save: empty (use auto) OR unique + correct format, not mid-check. */
  valid: boolean;
  /** Canonical zero-padded form of the value (for blur auto-format). */
  padded: string;
  /** Inline message to display, or null. */
  error: string | null;
}

export function useDocNumber(
  type: DocNumberType,
  value: string,
  /** PURCHASE ORDERS ONLY. Each PO type is its own series with its own running
   *  number (IN-MPO- / IN-JWPO- / IN-SPO- / IN-OPO-), so the suggested next
   *  code depends on the type the form is currently on. It is part of the query
   *  key too: switching the dropdown must ask again, not reuse the old series'
   *  answer. Omitted for every other document type. */
  poType?: PoType,
): DocNumberState {
  const evalNow = evaluateDocNumber(type, value);
  const debounced = useDebounce(value.trim(), 500);
  const debouncedEval = evaluateDocNumber(type, debounced);
  const poTypeParam = poType ? `&poType=${poType}` : '';

  // Default / suggested next code (code omitted) — fetched once per type+series.
  const nextQ = useQuery<CheckDocNumberResponse>({
    queryKey: ['doc-number', type, poType ?? null, '__next__'],
    queryFn: () => apiFetch<CheckDocNumberResponse>(`/doc-numbers/check?type=${type}${poTypeParam}`),
    staleTime: 0,
  });

  // Duplicate check — only for a non-empty, well-formatted value (spec: no
  // backend call for invalid formats).
  const checkQ = useQuery<CheckDocNumberResponse>({
    queryKey: ['doc-number', type, poType ?? null, debounced],
    queryFn: () =>
      apiFetch<CheckDocNumberResponse>(
        `/doc-numbers/check?type=${type}&code=${encodeURIComponent(debounced)}${poTypeParam}`,
      ),
    enabled: debouncedEval.shouldCheck,
    staleTime: 0,
  });

  const duplicate = debouncedEval.shouldCheck && checkQ.data?.exists === true;
  // Mid-check: the value warrants a check but either the debounce hasn't caught
  // up or the request is in flight.
  const pendingDebounce = evalNow.shouldCheck && value.trim() !== debounced;
  const checking =
    evalNow.shouldCheck && (pendingDebounce || (debouncedEval.shouldCheck && checkQ.isFetching));
  const formatInvalid = evalNow.formatInvalid;
  // poType goes through so the wording names the series the form is on —
  // "expected IN-JWPO-NNNNN/R1" on a job-work PO, not the retired IN-PO-.
  const error = docNumberError(type, {
    formatInvalid,
    duplicate: Boolean(duplicate),
    ...(poType ? { poType } : {}),
  });
  const valid = !formatInvalid && !duplicate && !checking;

  return {
    nextCode: nextQ.data?.nextCode,
    defaultLoading: nextQ.isLoading,
    checking,
    duplicate: Boolean(duplicate),
    formatInvalid,
    valid,
    padded: evalNow.padded,
    error,
  };
}
