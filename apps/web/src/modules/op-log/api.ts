import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export interface OpLogListItem {
  id: string;
  logNo: string;
  logType: 'start' | 'complete' | 'qc';
  logDate: string;
  jcNo: string;
  itemCode: string | null;
  opSeq: number;
  operation: string | null;
  machineCode: string | null;
  shift: string;
  qty: number;
  rejectQty: number;
  operatorName: string | null;
  remarks: string | null;
  isTpi: boolean;
  qcReportPath: string | null;
  qcReportName: string | null;
  createdAt: string;
  createdBy: string | null;
  createdByName: string | null;
}

export interface ListOpLogQuery {
  jcNo?: string | undefined;
  logType?: 'start' | 'complete' | 'qc' | undefined;
  shift?: 'day' | 'night' | 'general' | undefined;
  operatorId?: string | undefined;
  fromDate?: string | undefined;
  toDate?: string | undefined;
  limit: number;
  offset: number;
}

export interface ListOpLogResponse {
  items: OpLogListItem[];
  total: number;
  limit: number;
  offset: number;
}

export const opLogKeys = {
  all: ['op-log'] as const,
  list: (q: ListOpLogQuery) => [...opLogKeys.all, 'list', q] as const,
};

function toQueryString(q: ListOpLogQuery): string {
  const params = new URLSearchParams();
  if (q.jcNo) params.set('jcNo', q.jcNo);
  if (q.logType) params.set('logType', q.logType);
  if (q.shift) params.set('shift', q.shift);
  if (q.operatorId) params.set('operatorId', q.operatorId);
  if (q.fromDate) params.set('fromDate', q.fromDate);
  if (q.toDate) params.set('toDate', q.toDate);
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

export function useOpLog(
  query: ListOpLogQuery,
  options?: Omit<UseQueryOptions<ListOpLogResponse>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<ListOpLogResponse>({
    queryKey: opLogKeys.list(query),
    queryFn: () => apiFetch<ListOpLogResponse>(`/op-log?${toQueryString(query)}`),
    placeholderData: (prev) => prev,
    ...options,
  });
}
