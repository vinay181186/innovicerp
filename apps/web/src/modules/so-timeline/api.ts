import type { SoTimelineResponse } from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const soTimelineKeys = {
  all: ['so-timeline'] as const,
  detail: (soId: string | null) => [...soTimelineKeys.all, soId] as const,
};

export function useSoTimeline(soId: string | null) {
  return useQuery<SoTimelineResponse>({
    queryKey: soTimelineKeys.detail(soId),
    queryFn: () => apiFetch<SoTimelineResponse>(`/so-timeline/${soId}`),
    enabled: !!soId,
    refetchOnWindowFocus: true,
  });
}
