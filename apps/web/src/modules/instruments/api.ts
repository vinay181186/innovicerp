// Instrument register (ADR-193 phase 4a) — TanStack Query hooks.
import type {
  CreateInstrumentInput,
  DocumentEditStagedResult,
  InstrumentDetail,
  InstrumentListItem,
  ListInstrumentsQuery,
  ListInstrumentsResponse,
  RecordCalibrationInput,
  MarkMissingInstrumentInput,
  ScrapInstrumentInput,
  SendForCalibrationInput,
  UnregisteredCount,
  UpdateInstrumentInput,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { type SaveKey, withSaveKey } from '@/lib/use-save-key';

export const instrumentsKeys = {
  all: ['instruments'] as const,
  list: (q: ListInstrumentsQuery) =>
    [
      ...instrumentsKeys.all,
      'list',
      q.search ?? null,
      q.itemId ?? null,
      q.status ?? null,
      q.due ?? null,
      q.sf ?? null,
      q.limit,
      q.offset,
    ] as const,
  detail: (id: string) => [...instrumentsKeys.all, 'detail', id] as const,
  unregistered: () => [...instrumentsKeys.all, 'unregistered'] as const,
};

function buildSearch(q: ListInstrumentsQuery): string {
  const p = new URLSearchParams();
  if (q.search) p.set('search', q.search);
  if (q.itemId) p.set('itemId', q.itemId);
  if (q.status) p.set('status', q.status);
  if (q.due) p.set('due', q.due);
  if (q.sf) p.set('sf', q.sf);
  p.set('limit', String(q.limit));
  p.set('offset', String(q.offset));
  return p.toString();
}

export function useInstrumentsList(query: ListInstrumentsQuery, enabled = true) {
  return useQuery<ListInstrumentsResponse>({
    queryKey: instrumentsKeys.list(query),
    queryFn: () => apiFetch<ListInstrumentsResponse>(`/instruments?${buildSearch(query)}`),
    placeholderData: (prev) => prev,
    enabled,
  });
}

export function useInstrument(id: string | null) {
  return useQuery<InstrumentDetail>({
    queryKey: instrumentsKeys.detail(id ?? ''),
    queryFn: () => apiFetch<InstrumentDetail>(`/instruments/${id}`),
    enabled: Boolean(id),
  });
}

export function useUnregisteredInstruments() {
  return useQuery<UnregisteredCount[]>({
    queryKey: instrumentsKeys.unregistered(),
    queryFn: () => apiFetch<UnregisteredCount[]>('/instruments/unregistered'),
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>): void {
  void qc.invalidateQueries({ queryKey: instrumentsKeys.all });
  void qc.invalidateQueries({ queryKey: ['tool-issues'] });
  void qc.invalidateQueries({ queryKey: ['store-inventory'] });
  void qc.invalidateQueries({ queryKey: ['store-transactions'] });
}

export function useCreateInstrument(saveKey?: SaveKey) {
  const qc = useQueryClient();
  return useMutation<InstrumentListItem, Error, CreateInstrumentInput>({
    mutationFn: (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<InstrumentListItem>('/instruments', {
          method: 'POST',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: () => invalidate(qc),
  });
}

export function useUpdateInstrument() {
  const qc = useQueryClient();
  // ADR-202 — when the edit-approval gate is on and the instrument is live, the
  // PATCH returns a DocumentEditStagedResult (the edit was staged for approval)
  // instead of the updated row. The edit form reads the union to tell them apart.
  return useMutation<
    InstrumentListItem | DocumentEditStagedResult,
    Error,
    { id: string } & UpdateInstrumentInput
  >({
    mutationFn: ({ id, ...body }) =>
      apiFetch<InstrumentListItem | DocumentEditStagedResult>(`/instruments/${id}`, {
        method: 'PATCH',
        json: body,
      }),
    onSuccess: (updated) => {
      invalidate(qc);
      // Refresh the inbox + the detail-modal pending chip when an edit is staged.
      if ('staged' in updated) {
        void qc.invalidateQueries({ queryKey: ['document-edits'] });
      }
    },
  });
}

export function useSendForCalibration() {
  const qc = useQueryClient();
  return useMutation<InstrumentListItem, Error, { id: string } & SendForCalibrationInput>({
    mutationFn: ({ id, ...body }) =>
      apiFetch<InstrumentListItem>(`/instruments/${id}/calibration-out`, {
        method: 'POST',
        json: body,
      }),
    onSuccess: () => invalidate(qc),
  });
}

export function useRecordCalibration() {
  const qc = useQueryClient();
  return useMutation<InstrumentListItem, Error, { id: string } & RecordCalibrationInput>({
    mutationFn: ({ id, ...body }) =>
      apiFetch<InstrumentListItem>(`/instruments/${id}/calibrate`, { method: 'POST', json: body }),
    onSuccess: () => invalidate(qc),
  });
}

export function useScrapInstrument() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, { id: string } & ScrapInstrumentInput>({
    mutationFn: ({ id, ...body }) =>
      apiFetch(`/instruments/${id}/scrap`, { method: 'POST', json: body }),
    onSuccess: () => invalidate(qc),
  });
}

/** An In Store piece that cannot be found → pending Lost write-off (approve tier). */
export function useMarkMissingInstrument() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, { id: string } & MarkMissingInstrumentInput>({
    mutationFn: ({ id, ...body }) =>
      apiFetch(`/instruments/${id}/mark-missing`, { method: 'POST', json: body }),
    onSuccess: () => invalidate(qc),
  });
}
