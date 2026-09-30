// Flow views (requirement 3.5) — read-only query hooks. Each view is fetched
// only when its panel is opened (`enabled`), so a page that never opens one
// pays nothing for it.
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import type {
  LevelMatrixResponse,
  NcTimelineResponse,
  OpFlowResponse,
  ReworkTreeResponse,
} from './types';

export const flowViewsKeys = {
  all: ['flow-views'] as const,
  opFlow: (jobCardId: string) => [...flowViewsKeys.all, 'op-flow', jobCardId] as const,
  reworkTree: (jobCardId: string) => [...flowViewsKeys.all, 'rework-tree', jobCardId] as const,
  ncTimeline: (ncId: string) => [...flowViewsKeys.all, 'nc-timeline', ncId] as const,
  levelMatrix: (soId: string) => [...flowViewsKeys.all, 'level-matrix', soId] as const,
};

export function useOpFlow(jobCardId: string, enabled = true) {
  return useQuery<OpFlowResponse>({
    queryKey: flowViewsKeys.opFlow(jobCardId),
    queryFn: () => apiFetch<OpFlowResponse>(`/flow-views/job-cards/${jobCardId}/op-flow`),
    enabled: enabled && Boolean(jobCardId),
  });
}

export function useReworkTree(jobCardId: string, enabled = true) {
  return useQuery<ReworkTreeResponse>({
    queryKey: flowViewsKeys.reworkTree(jobCardId),
    queryFn: () => apiFetch<ReworkTreeResponse>(`/flow-views/job-cards/${jobCardId}/rework-tree`),
    enabled: enabled && Boolean(jobCardId),
  });
}

export function useNcTimeline(ncId: string, enabled = true) {
  return useQuery<NcTimelineResponse>({
    queryKey: flowViewsKeys.ncTimeline(ncId),
    queryFn: () => apiFetch<NcTimelineResponse>(`/flow-views/nc/${ncId}/timeline`),
    enabled: enabled && Boolean(ncId),
  });
}

export function useLevelMatrix(salesOrderId: string, enabled = true) {
  return useQuery<LevelMatrixResponse>({
    queryKey: flowViewsKeys.levelMatrix(salesOrderId),
    queryFn: () =>
      apiFetch<LevelMatrixResponse>(`/flow-views/sales-orders/${salesOrderId}/level-matrix`),
    enabled: enabled && Boolean(salesOrderId),
  });
}
