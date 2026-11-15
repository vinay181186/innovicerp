// Ask ERP chat (ADR-293) — L6 Super Admin only. The panel sends a question to
// POST /ai-chat; the server reads live ERP data and never writes ERP data.
// The only cached thing is this person's "n of 100 today" counter.

import type { AiChatRequest, AiChatResponse, AiChatUsage } from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { type SaveKey, withSaveKey } from '@/lib/use-save-key';

export const aiChatKeys = {
  all: ['ai-chat'] as const,
  usage: () => [...aiChatKeys.all, 'usage'] as const,
};

/** An answer can take a while: the model may look several things up. */
const ASK_TIMEOUT_MS = 90_000;

/** Questions asked today. Read only while the panel is open, for a Super Admin. */
export function useAiChatUsage(enabled: boolean) {
  return useQuery({
    queryKey: aiChatKeys.usage(),
    queryFn: () => apiFetch<AiChatUsage>('/ai-chat/usage'),
    enabled,
  });
}

export function useAskAiChat(saveKey: SaveKey) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AiChatRequest) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<AiChatResponse>('/ai-chat', {
          method: 'POST',
          json: input,
          timeoutMs: ASK_TIMEOUT_MS,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: (res) => {
      qc.setQueryData<AiChatUsage>(aiChatKeys.usage(), {
        usedToday: res.usedToday,
        dailyLimit: res.dailyLimit,
      });
    },
  });
}
