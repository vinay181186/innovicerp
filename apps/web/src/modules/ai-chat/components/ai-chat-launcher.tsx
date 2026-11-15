// Ask ERP launcher (ADR-293): the "Ask ERP" button fixed at the bottom-right, for
// L6 Super Admin only; it opens the chat panel. The conversation lives here, so
// closing the panel keeps it for this session; a reload clears it.

import { type AiChatModel, aiChatModelSchema } from '@innovic/shared';
import { MessageSquare } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSession } from '@/lib/session';
import { Button } from '@/ui/core';
import { Z_OVERLAY } from '@/ui/feedback';
import type { ChatExchange } from '../lib/chat-types';
import { AiChatPanel } from './ai-chat-panel';

const MODEL_KEY = 'ai-chat-model';

function readModel(): AiChatModel {
  try {
    const saved = aiChatModelSchema.safeParse(window.localStorage.getItem(MODEL_KEY));
    return saved.success ? saved.data : 'auto';
  } catch {
    return 'auto';
  }
}

function saveModel(m: AiChatModel): void {
  try {
    window.localStorage.setItem(MODEL_KEY, m);
  } catch {
    // Private mode / storage full: the pick still holds for this session.
  }
}

export function AiChatLauncher(): React.JSX.Element | null {
  // The server's gate is role admin (requireAdminRole — only L6 Full Access
  // gets it), so the button checks exactly that, not fullAccess on its own.
  const { data: me } = useSession();
  const isSuperAdmin = me?.role === 'admin';
  const [open, setOpen] = useState(false);
  const [model, setModel] = useState<AiChatModel>(readModel);
  const [exchanges, setExchanges] = useState<ChatExchange[]>([]);
  const launcherRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);

  // Focus returns to the launcher when the panel closes.
  useEffect(() => {
    if (wasOpen.current && !open) launcherRef.current?.querySelector('button')?.focus();
    wasOpen.current = open;
  }, [open]);

  if (!isSuperAdmin) return null;

  if (open)
    return (
      <AiChatPanel
        model={model}
        onModel={(m) => {
          setModel(m);
          saveModel(m);
        }}
        exchanges={exchanges}
        setExchanges={setExchanges}
        onClose={() => setOpen(false)}
      />
    );

  return (
    <div
      ref={launcherRef}
      style={{ position: 'fixed', right: 'var(--sp-4)', bottom: 'var(--sp-4)', zIndex: Z_OVERLAY }}
    >
      <Button
        variant="primary"
        icon={<MessageSquare size={14} />}
        style={{ height: 40 }}
        onClick={() => setOpen(true)}
      >
        Ask ERP
      </Button>
    </div>
  );
}
