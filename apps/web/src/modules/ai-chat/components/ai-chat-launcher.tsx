// Ask ERP launcher (ADR-293): the Ask ERP symbol in the top bar, for L6 Super Admin
// only; it opens and closes the chat panel. The conversation lives here, so closing
// the panel keeps it for this session; a reload clears it.
//
// Owner 2026-11-16: it was a button fixed at the bottom-right, where it sat on top of
// every form's Save button and every list's Next page button. Now it is one small
// symbol between the bell and the password key (TopNav), and the panel opens under
// the header and stops above the Save bar (FloatingPanel `top` / ABOVE_SAVE_BAR).

import { type AiChatModel, aiChatModelSchema } from '@innovic/shared';
import { MessageSquare } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSession } from '@/lib/session';
import type { ChatExchange } from '../lib/chat-types';
import { AiChatPanel } from './ai-chat-panel';

const MODEL_KEY = 'ai-chat-model';
/** Gap between the bottom of the app header and the top of the panel. */
const PANEL_GAP_PX = 8;

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
  const [top, setTop] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<(() => void) | null>(null);
  const wasOpen = useRef(false);

  // Focus returns to the button when the panel closes — also on browsers where a
  // click does not focus a button (Safari), so the panel's own "back to the opener"
  // would land on <body>. Runs after the panel's unmount cleanup.
  useEffect(() => {
    if (wasOpen.current && !open) buttonRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  // The panel starts just under the app header, which can grow (a pending-days
  // band, the right cluster wrapping on a narrow window) — follow it while open.
  useLayoutEffect(() => {
    if (!open) return;
    const header = document.getElementById('app-header');
    const place = (): void =>
      setTop(Math.round(header?.getBoundingClientRect().bottom ?? 0) + PANEL_GAP_PX);
    place();
    if (!header) return;
    const watch = new ResizeObserver(place);
    watch.observe(header);
    return () => watch.disconnect();
  }, [open]);

  if (!isSuperAdmin) return null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`btn btn-sm tn-iconbtn tn-ask ${open ? 'btn-primary' : 'btn-ghost'}`}
        title={open ? 'Close Ask ERP (the chat is kept)' : 'Ask ERP'}
        aria-label={open ? 'Close Ask ERP' : 'Ask ERP'}
        aria-expanded={open}
        // Open: the panel's own close, so typed text still asks before it goes.
        onClick={() => (open ? closeRef.current?.() : setOpen(true))}
      >
        <MessageSquare size={15} aria-hidden />
      </button>
      {open ? (
        <AiChatPanel
          model={model}
          onModel={(m) => {
            setModel(m);
            saveModel(m);
          }}
          exchanges={exchanges}
          setExchanges={setExchanges}
          onClose={() => setOpen(false)}
          top={top}
          toggleRef={buttonRef}
          closeRef={closeRef}
        />
      ) : null}
    </>
  );
}
