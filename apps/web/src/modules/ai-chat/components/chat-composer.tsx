// Ask ERP composer (ADR-293): the question box, Attach (or paste a screenshot),
// Speak, and Send. Enter sends, Shift+Enter is a new line. While a question is on
// its way every control is off, so a double click cannot send it twice.

import { AI_CHAT_QUESTION_MAX } from '@innovic/shared';
import { FileText, Image as ImageIcon, Mic, Square } from 'lucide-react';
import { useId, useRef } from 'react';
import { Button, Icon, IconButton } from '@/ui/core';
import { Banner } from '@/ui/feedback';
import { Textarea } from '@/ui/forms';
import { ACCEPT, type PickedFile, sizeLabel } from '../lib/attachments';
import type { SpeechInput } from '../lib/use-speech-input';

export interface ChatComposerProps {
  draft: string;
  onDraft: (text: string) => void;
  files: PickedFile[];
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (id: string) => void;
  /** Orange notices: refused files, Speak not available. */
  notices: string[];
  onDismissNotices: () => void;
  speech: SpeechInput;
  pending: boolean;
  /** Today's limit is used up: nothing can be sent until tomorrow. */
  locked: boolean;
  usageText: string;
  onSend: () => void;
}

const ROW: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' };

export function ChatComposer(p: ChatComposerProps): React.JSX.Element {
  const boxId = useId();
  const pickRef = useRef<HTMLInputElement>(null);
  const off = p.pending || p.locked;
  const empty = !p.draft.trim() && p.files.length === 0;
  const sendOff = empty || off || p.speech.listening;

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (!sendOff) p.onSend();
  };

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const pasted = Array.from(e.clipboardData.files);
    if (pasted.length === 0) return;
    e.preventDefault();
    p.onAddFiles(pasted);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
      {p.notices.length > 0 ? (
        <Banner tone="warn" flush onDismiss={p.onDismissNotices}>
          {p.notices.map((n, i) => (
            <div key={i}>{n}</div>
          ))}
        </Banner>
      ) : null}
      {p.speech.listening ? (
        <Banner tone="error" flush>
          Listening… speak your question, then press Stop. Words appear in the box; you check them
          before sending.
          {p.speech.interim ? <div className="text3">{p.speech.interim}</div> : null}
        </Banner>
      ) : null}
      <label htmlFor={boxId} className="text3" style={{ fontSize: 'var(--fs-xs)' }}>
        Your question — type, speak, or paste a screenshot (Ctrl+V)
      </label>
      <Textarea
        id={boxId}
        rows={2}
        maxLength={AI_CHAT_QUESTION_MAX}
        placeholder="e.g. Open job cards due this week"
        value={p.draft}
        disabled={off}
        onChange={(e) => p.onDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
      />
      {p.files.length > 0 ? (
        <div style={{ ...ROW, flexWrap: 'wrap' }}>
          {p.files.map((f) => (
            <span
              key={f.id}
              style={{
                ...ROW,
                gap: 'var(--sp-1)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                background: 'var(--surface-card)',
                padding: 'var(--sp-0) var(--sp-1)',
                fontSize: 'var(--fs-xs)',
                maxWidth: '100%',
              }}
            >
              {f.type === 'application/pdf' ? <FileText size={13} /> : <ImageIcon size={13} />}
              <span
                title={f.name}
                style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {f.name}
              </span>
              <span className="text3" style={{ whiteSpace: 'nowrap' }}>
                {sizeLabel(f.size)}
              </span>
              <IconButton
                size="sm"
                title="Remove file"
                aria-label="Remove file"
                disabled={p.pending}
                icon={<Icon name="x" size={12} />}
                onClick={() => p.onRemoveFile(f.id)}
              />
            </span>
          ))}
        </div>
      ) : null}
      <div style={ROW}>
        <input
          ref={pickRef}
          type="file"
          hidden
          multiple
          accept={ACCEPT}
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            // Cleared so picking the same file again after removing it still fires.
            e.target.value = '';
            if (picked.length > 0) p.onAddFiles(picked);
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          icon={<Icon name="paperclip" size={13} />}
          disabled={off}
          onClick={() => pickRef.current?.click()}
        >
          Attach
        </Button>
        {p.speech.listening ? (
          <Button
            variant="danger"
            size="sm"
            aria-label="Stop listening"
            icon={<Square size={12} />}
            onClick={p.speech.stop}
          >
            Stop
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            icon={<Mic size={13} />}
            disabled={off}
            onClick={p.speech.start}
          >
            Speak
          </Button>
        )}
        <span className="text3" style={{ flex: 1, minWidth: 0, fontSize: 'var(--fs-xs)' }}>
          {p.usageText}
        </span>
        <Button variant="primary" size="sm" disabled={sendOff} onClick={p.onSend}>
          {p.pending ? 'Asking…' : 'Send'}
        </Button>
      </div>
    </div>
  );
}
