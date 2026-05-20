import type { Company, UpdateCompanyInput } from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const companyKeys = {
  all: ['company'] as const,
  me: () => [...companyKeys.all, 'me'] as const,
};

export function useMyCompany() {
  return useQuery<Company>({
    queryKey: companyKeys.me(),
    queryFn: () => apiFetch<Company>('/companies/me'),
  });
}

export function useUpdateMyCompany() {
  const qc = useQueryClient();
  return useMutation<Company, Error, UpdateCompanyInput>({
    mutationFn: (input) => apiFetch<Company>('/companies/me', { method: 'PATCH', json: input }),
    onSuccess: (updated) => {
      qc.setQueryData(companyKeys.me(), updated);
    },
  });
}
